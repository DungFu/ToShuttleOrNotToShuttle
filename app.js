var co = require('co');
var forEach = require('co-foreach');
var path = require('path');
var url = require('url');
var swig = require('swig');
var request = require("co-request");
var redis = require('redis');
var wrapper = require('co-redis');
var mongoose = require('mongoose');
var serve = require('koa-static');
var bodyParser = require('koa-bodyparser');
var session = require('koa-generic-session');
var redisStore = require('koa-redis');
var koa = require('koa');
var app = koa();
var router = require('koa-router')();

var MS_IN_MINUTE = 60000;
var UPDATE_START_HOUR = 10;
var UPDATE_END_HOUR = 20;

var mapsApiKey;
if (process.env.MAPS_API_KEY) {
	mapsApiKey = process.env.MAPS_API_KEY;
} else {
	mapsApiKey = require('./config.json').mapsApiKey;
}

var locations = {
	work14: "1+Hacker+Way+Menlo+Park+CA",
	fremont: "2000+Bart+Way+Fremont+CA",
	oakland: "12th+St.+Oakland+City+Center+Oakland+CA",
	berkeley: "1945+Milvia+St+Berkeley+CA"
};

var routes = [
	{
		name: "Oakland",
		legs: [[locations.work14, locations.oakland, "driving"], [locations.oakland, locations.berkeley, "transit"]],
		times: [
			{
				hour: 16,
				minute: 20,
				name: "Shuttle 1",
				addTime: 0
			},
			{
				hour: 17,
				minute: 30,
				name: "Shuttle 2",
				addTime: 8
			},
			{
				hour: 18,
				minute: 12,
				name: "Shuttle 3",
				addTime: 8
			},
			{
				hour: 19,
				minute: 20,
				name: "Shuttle 4",
				addTime: 8
			}
		]
	},
	{
		name: "Fremont",
		legs: [[locations.work14, locations.fremont, "driving"], [locations.fremont, locations.berkeley, "transit"]],
		times: [
			{
				hour: 16,
				minute: 25,
				name: "Shuttle 1",
				addTime: 0
			},
			{
				hour: 17,
				minute: 25,
				name: "Shuttle 2",
				addTime: 0
			},
			{
				hour: 18,
				minute: 25,
				name: "Shuttle 3",
				addTime: 0
			},
			{
				hour: 19,
				minute: 05,
				name: "Shuttle 4",
				addTime: 0
			}
		]
	}
];

var distanceMatrixApiUrl = "https://maps.googleapis.com/maps/api/distancematrix/json?";
var timezoneApiUrl = "https://maps.googleapis.com/maps/api/timezone/json?";

// Set up Heroku Redis
var client;
if (process.env.REDIS_URL) {
  client = redis.createClient(process.env.REDIS_URL);
} else {
  client = redis.createClient();
}

var clientCo = wrapper(client);

function logError(err) {
	console.error(err);
}

function pad(n, width) {
  n = n + '';
  return n.length >= width ? n : new Array(width - n.length + 1).join('0') + n;
}

var setData = co.wrap(function *(index, routeData) {
	var len = yield clientCo.llen("routeData")
	if (len > index) {
		yield clientCo.lset("routeData", index, JSON.stringify(routeData));
	}
});

var updateDurations = co.wrap(function *(route, offset, timezoneOffset) {
	yield forEach(route.times, function *(time, index) {
		var d = new Date(Date.now() + timezoneOffset);
		d.setUTCHours(time.hour);
		d.setUTCMinutes(time.minute);
		d.setSeconds(0);
		d.setMilliseconds(0);
		if (d.getTime() - timezoneOffset < Date.now()) {
			d = new Date(d.getTime() + 24*60*60*1000);
		}
		var printTime = pad(d.getUTCHours(),2)+":"+pad(d.getUTCMinutes(),2)+" "+d.getUTCFullYear()+"/"+pad(d.getUTCMonth()+1, 2)+"/"+pad(d.getUTCDate(), 2);
		var rDate = new Date(d.getTime() - timezoneOffset + time.addTime*MS_IN_MINUTE);
		yield updateSingleDuration(offset+index, printTime, rDate, route, time, 0, 0, 0);
	});
});

var fetchRouteData = co.wrap(function *(origin, dest, mode, departureTime) {
	var routeResponse = yield request(distanceMatrixApiUrl+"origins="+origin+"&destinations="+dest+"&mode="+mode+"&departure_time="+departureTime+"&units=imperial&key="+mapsApiKey);
	if (routeResponse.statusCode != 200) {
		throw new Error("Invalid route response status code: " + routeResponse.statusCode);
	}
	var parsedBody = JSON.parse(routeResponse.body);
	if (parsedBody.status != "OK") {
		throw new Error("Invalid route body status: " + parsedBody.status);
	}
	return parsedBody;
});

var updateSingleDuration = co.wrap(function *(index, printTime, rDate, route, time, leg, collectiveDuration, collectiveDiffDuration) {
	var rTime = Math.floor(rDate.getTime()/1000);
	var eta = new Date();
	eta.setHours(time.hour);
	eta.setMinutes(time.minute);
	var routeData = yield fetchRouteData(route.legs[leg][0], route.legs[leg][1], route.legs[leg][2], rTime);
	var duration = 0;
	var diffDuration = 0;
	if (routeData.rows[0].elements[0].duration_in_traffic == null) {
		duration = routeData.rows[0].elements[0].duration.value;
	} else {
		duration = routeData.rows[0].elements[0].duration_in_traffic.value;
		diffDuration = duration - routeData.rows[0].elements[0].duration.value;
	}
	if (leg == route.legs.length - 1) {
		var totalDuration = collectiveDuration + duration + time.addTime*60;
		var totalDiffDuration = collectiveDiffDuration + diffDuration;
		eta = new Date(eta.getTime() + totalDuration*1000);
		yield setData(index, [time.name, route.name, printTime, Math.round(totalDuration/60), Math.round(totalDiffDuration/60), String(eta.getHours())+":"+String(eta.getMinutes())]);
	} else {
		yield updateSingleDuration(index, printTime, new Date(rDate.getTime() + duration), route, time, leg+1, collectiveDuration + duration, collectiveDiffDuration + diffDuration);
	}
});

var fetchTimeZoneOffset = co.wrap(function *() {
	var timezoneResponse = yield request(timezoneApiUrl+"location=37,-122&timestamp="+Date.now()/1000+"&key="+mapsApiKey);
	if (timezoneResponse.statusCode != 200) {
		throw new Error("Invalid timezone response status code: " + timezoneResponse.statusCode);
	}
	var parsedBody = JSON.parse(timezoneResponse.body);
	if (parsedBody.status != "OK") {
		throw new Error("Invalid timezone body status: " + parsedBody.status);
	}
	return parsedBody.rawOffset * 1000;
});

var updateAllDurations = co.wrap(function *() {
	var timezoneOffset = yield fetchTimeZoneOffset();
	var date = new Date(Date.now() + timezoneOffset);
	if (date.getUTCHours() >= UPDATE_START_HOUR && date.getUTCHours() <= UPDATE_END_HOUR) {
		var lastUpdateTime = yield clientCo.get("lastUpdateTime");
		var now = Date.now();
		if (lastUpdateTime == null || now - Number(lastUpdateTime) > 15*MS_IN_MINUTE) {
			var offset = 0;
			for (var i = 0; i < routes.length; i++) {
				yield updateDurations(routes[i], offset, timezoneOffset);
				offset += routes[i].times.length;
			}
			yield clientCo.set("lastUpdateTime", now);
			console.log("updating...");
		}
	}
});

var totalLength = 0;
for (var i = 0; i < routes.length; i++) {
	totalLength += routes[i].times.length;
}

co(function* () {
	var len = yield clientCo.llen("routeData");
	if (len != totalLength) {
		yield clientCo.del("lastUpdateTime");
		yield clientCo.del("routeData");
		for (var j = 0; j < totalLength; j++) {
			yield clientCo.rpush("routeData", "");
		}
	}
	yield updateAllDurations();
}).catch(logError);

var rootTemplate = swig.compileFile(path.join(__dirname, '/views/index.html'));
var loginTemplate = swig.compileFile(path.join(__dirname, '/views/login.html'));

app.use(serve(path.join(__dirname, '/static')));
app.use(bodyParser());
var secret;
if (process.env.APP_SECRET) {
  secret = process.env.APP_SECRET;
} else {
  secret = require('./config.json').appSecret;
}
app.keys = [secret];
app.use(session({
	store: redisStore({
		client: client
	})
}));

mongoose.connect(process.env.MONGOLAB_URI || require('./config.json').mongoUri);
var User = require('./models/user')(mongoose);

var passport = require('./auth')(User)
app.use(passport.initialize());
app.use(passport.session());

router.get('/auth/facebook', passport.authenticate('facebook'));

router.get('/auth/facebook/callback', passport.authenticate('facebook', {
	successRedirect: '/',
	failureRedirect: '/login'
}));

router.get('/login', function *(next) {
	if (this.isAuthenticated()) {
		this.redirect('/');
	} else {
		this.body = loginTemplate();
	}
});

router.get('/logout', function *(next){
  this.logout();
  this.redirect('/');
});

router.get('/', function *(next) {
	if (this.isAuthenticated()) {
		try {
			yield updateAllDurations();
		} catch (err) {
			logError(err);
		}
		var routes = yield clientCo.lrange("routeData", 0, -1);
		for (var i = 0; i < routes.length; i++) {
			try {
				routes[i] = JSON.parse(routes[i]);
			} catch (err) {
				logError(err);
			}
		}
		var lastUpdateTime = yield clientCo.get("lastUpdateTime");
		this.body = rootTemplate({
			routes: routes,
			minutesAgo: Math.round((Date.now() - lastUpdateTime)/1000/60)
		});
	} else {
		this.redirect('/login');
	}
});

app.use(router.routes());
app.use(router.allowedMethods());

app.listen(process.env.PORT || 3000);
