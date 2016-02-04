var passport = require('koa-passport');

var config;
if (process.env.FACEBOOK_CONFIG) {
  config = JSON.parse(process.env.FACEBOOK_CONFIG);
} else {
  config = require('./config.json').facebookConfig;
}

module.exports = function(client) {
  passport.serializeUser(function(user, done) {
    done(null, user.id);
  });

  passport.deserializeUser(function (id, done) {
    client.get("user-"+id, function(err, user) {
      done(null, JSON.parse(user));
    });
  });

  var FacebookStrategy = require('passport-facebook').Strategy
  passport.use(new FacebookStrategy({
      clientID: config.appId,
      clientSecret: config.appSecret,
      callbackURL: config.appAddress + '/auth/facebook/callback'
    },
    function(token, tokenSecret, profile, done) {
      var id = profile.id;
      client.get("user-"+id, function(err, user) {
        if (user != null) {
          done(null, JSON.parse(user));
        } else {
          var newUser = {
            id: id,
            name: profile.displayName
          };
          client.set("user-"+id, JSON.stringify(newUser), function(err, user) {
            done(null, newUser);
          });
        }
      });
    }
  ));

  return passport;
};
