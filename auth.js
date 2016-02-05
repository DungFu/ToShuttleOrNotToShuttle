var co = require('co');
var passport = require('koa-passport');

var config;
if (process.env.FACEBOOK_CONFIG) {
	config = JSON.parse(process.env.FACEBOOK_CONFIG);
} else {
	config = require('./config.json').facebookConfig;
}

module.exports = function(User) {
	passport.serializeUser(function (user, done) {
		done(null, user.id);
	});

	passport.deserializeUser(function (id, done) {
		co(function *() {
			var user = yield User.findOne({id: id});
			done(null, user);
		});
	});

	var FacebookStrategy = require('passport-facebook').Strategy
	passport.use(new FacebookStrategy({
			clientID: config.appId,
			clientSecret: config.appSecret,
			callbackURL: config.appAddress + '/auth/facebook/callback'
		},
		function (token, tokenSecret, profile, done) {
			co(function *() {
				var user = yield User.findOne({id: profile.id});
				if (!user) {
					user = new User({
						id: profile.id,
						name: profile.displayName
					});
					yield user.save();
					done(null, user);
				} else {
					done(null, user);
				}
			}).catch(function(err) {
				console.error(err);
				done(err);
			});
		}
	));

	return passport;
};
