# ToShuttleOrNotToShuttle

You will need to create a config.json file for running this (or create the variables in the config.json in your Heroku config variables).

Example:

```
{
  "mapsApiKey": "AIzaSyA83woM6I6nkJsy2KxoAquFmnyB77ZrjhA",
  "appSecret": "myappsecret",
  "facebookConfig": {
    "appId": "1234567890",
    "appSecret": "abcdefghijklmnopqrstuvwxyz",
    "appAddress": "https://myappname.ngrok.io"
  }
}
```

For the Google Maps API key make sure you enable Distance Matrix API and Timezone API.
