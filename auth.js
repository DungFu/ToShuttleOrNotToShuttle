var passport = require('koa-passport');

var config;
if (process.env.FACEBOOK_CONFIG) {
  config = JSON.parse(process.env.FACEBOOK_CONFIG);
} else {
  config = require('./config.json').facebookConfig;
}

module.exports = function(User) {
  passport.serializeUser(function(user, done) {
    done(null, user.id);
  });

  passport.deserializeUser(function (id, done) {
    User.findOne({ id: id }, function (err, user) {
      done(err, user);
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
      User.findOne({ id: id }, function (err, user) {
        if (err) {
          return done(err);
        }
        if (!user) {
          user = new User({
            id: id,
            name: profile.displayName
          });
          user.save(function (err) {
            if (err) {
              console.log(err);
              return done(err);
            }
            return done(err, user);
          });
        } else {
          return done(err, user);
        }
      });
    }
  ));

  return passport;
};
