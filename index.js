"use strict";

// Initialize
const cityForecastBaseUri = "https://d95lokw8aag9n.cloudfront.net/city_forecast/3D/";
const advertisementByCountryUri = "https://d95lokw8aag9n.cloudfront.net/advertisements_by_country.json";

// Core Modules
const qs = require("querystring");
const https = require("https");

/*
    Make an asynchronous network call to get remote object, and parse it as JSON.
*/
const getRemoteJson = (url) => {
  return getString(url).then((ret) => {
    return JSON.parse(ret);
  });
};

/*
    Make an asynchronous network call to get remote object.
*/
const getString = (url) => {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if(res.statusCode < 400) {
        let rawData = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { rawData += chunk; });
        res.on("end", () => { 
          return resolve(rawData);
        });
      } else {
        reject(null);
      }
    }).on("error", (e) => {
      console.log("Error fetching JSON", e);
      return reject(e);
    });
  });
};


/*
  Make an asynchronous network call to prefetch advertisments by country (for server-side ad-insertion), and parse them as JSON.
*/ 
const getAdvertismentsPromise = () => {
  return getRemoteJson(advertisementByCountryUri);
}

/*
  On container initialization, make an asynchronous network call (for server-side ad-insertion) to prefetch advertisments by country,
  and parse them as JSON.
*/
var advertisementsPromise = getAdvertismentsPromise();

/*
  Return advertisements by country JSON (for server-side ad-insertion) once the asynchronous network 
  call completes. And re-try ONCE if the original request results in an error.
 */
const getAdvertisement = (country) => {
  return advertisementsPromise.then((advertisements) => {
    console.log("Ads " + JSON.stringify(advertisements));
    return advertisements.Advertisement[country] || "Generic Advertisement Sprite";
  }).catch((err) => {

    // In case the function couldn't fetch advertisements the first time, try again ONCE again.
    // And update the advertisment promise for the next caller.
    advertisementsPromise = getAdvertismentsPromise();
    return advertisementsPromise.then((advertisements) => {
      return advertisements.Advertisement[country] || "Generic Advertisement Sprite";
    }).catch((err) => {
      return {
        Advertisement: {}
      }
    });
  });
}

/*
    Get city forecast information from CloudFront cache at the edge. And example of how network calls could be used 
    to fetch objects from CloudFront cache.
*/
const getForecasts = (cities) => {
  // Make network call to get forecast information for each city.
  return Promise.all(cities.map((city) => {
    return getString(cityForecastBaseUri + city).then((forecast) => {

      // Return forecast for a city,
      return {
        city: city,
        forecast: forecast
      };
    }).catch((err) => {

      // If the forecast does not exist or there is an error fetching it, return "N/A".
      return {
        city: city,
        forecast: "N/A"
      };
    });
  }));
};

/*
   Bundled HTML forecast table template. An exmaple of how templates could bundle along with Lambda@Edge functions,
   and used to create personalized response for viewer.
*/
const getForecastHtml = (forecasts) => {
  return forecasts.reduce((html, item) => {
    // Format forecast information for each city as table.
    return html += `
          <tr>
            <td>${item.city}</td>
            <td>${(item.forecast) ? item.forecast : "N/A"}</td>
          </tr>`;
  }, ""); 
};

/*
   Bundled HTML response template. An exmaple of how templates could bundle along with Lambda@Edge functions,
   and used to create personalized response for viewer.
*/
const generateResponseBody = (args) => {
  //Format HTML response to the viewer.
  return `<!DOCTYPE html>
<html style="width: 100%; text-align: center;">
    <head>
        <title>Clima Edge - Weather Forecasts</title>
        <link rel="stylesheet" media="screen" href="http://d170se51itnvn3.cloudfront.net/style.css">
    </head>
    <body>
        <h1>Clima Edge - Forecasts</h1>
        <table style="width: 100%">
          <thead>
            <tr>
              <th>City</th>
              <th>Forecast</th>
            </tr>
          </thead>

          <tbody>
            ${getForecastHtml(args.forecasts)}
          </tbody>
        </table>
        <div class="ad-container">
          ${args.advertisement}
        </div>
        <div class="error">
          ${(args.error)? args.error:""}
        </div>
        <footer>
            <p>Generate at an AWS location near ${args.awsLocation}. Powered by Lambda@Edge.</p>
        </footer>
    </body>
</html>`;
};

/*
    Generate basic HTTP response using Lambda@Edge.
*/
const generateResponse = (args) => {
  // Format HTTP response to the viewer.
  return {
    "status": args.status,
    "statusDescription": args.statusDescription,
    "headers": {
      "vary": [
        {
          "key": "Vary",
          "value": "*"
        }
      ]
    },
    "body": generateResponseBody(args)
  };
};

/*
    Export API handler
*/
exports.handler = (event, context, callback) => {
  console.log("Service log, event: " + JSON.stringify(event));
  const req = event.Records[0].cf.request; // Viewer Request
  const query = qs.parse(req.querystring); // Query-String
  
  // Fetch advertisements and city forecasts from CloudFront cache.
  return Promise.all([
    // Fetch advertisements to be displayed for Viewer Country for server-side ad-insertion, from CloudFront cache (could be a third party advertisement provider).
    getAdvertisement(req.headers['cloudfront-viewer-country'][0].value), 
    
    // For requested cities in query-string, fetch forecast from CloudFront cache.
    getForecasts(query.cities ? query.cities.split(",") : []), 
  ]).then((ret) => {

    // Generate aggregated response for end user (and if configured, cache at the edge).
    let response = generateResponse({
      status: "200",
      statusDescription: "OK",
      advertisement: ret[0], // Insert advertisements (server-side ad-insertion)
      forecasts: ret[1], // Insert forecast for cities
      awsLocation: process.env.AWS_REGION,
    });

    console.log("Service log, response: " + JSON.stringify(response));
    return callback(null, response);
  }).catch((err) => {
    console.log("Service log, response: " + err);
    return callback(null, generateResponse({
      error: err
    }));
  });
};