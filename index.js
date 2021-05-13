#!/usr/bin/env node

const nodeFetch = require("node-fetch");
const moment = require("moment");
const notifier = require("node-notifier");
const nodeNotifier = require("node-notifier");
const ora = require("ora");
const boxen = require("boxen");
const { memoize, debounce, isEqual } = require("lodash");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");

const wait = (minutes) =>
  new Promise((resolve) => setTimeout(resolve, minutes * 60 * 1000));

const isWithinDays = (date, days) =>
  moment(date).diff(moment().startOf("day"), "days") <= days;

const fetch = (url, opts = {}) => {
  return nodeFetch(url, {
    ...opts,
    headers: {
      authorization: "Basic cHVibGljQHRyaW1vei5jb206MTIzNDU2Nzgh",
      "x-trimoz-role": "public",
      product: "clicsante",
      ...(opts.headers || {}),
    },
  })
    .then((res) => res.json())
    .catch((e) => ({}));
};

const getGeometry = memoize(async ({ postalCode }) => {
  const {
    results: [
      {
        geometry: {
          location: { lat: latitude, lng: longitude },
        },
      },
    ],
  } = await fetch(`https://api3.clicsante.ca/v3/geocode?address=${postalCode}`);

  return { latitude, longitude };
}, isEqual);

const getServiceId = async ({ establishmentId }) => {
  const [{ id }] = await fetch(
    `https://api3.clicsante.ca/v3/establishments/${establishmentId}/services`
  );
  return id;
};

const getAvailabilitiesForPlace = async ({ place, startDate, endDate }) => {
  const { availabilities } = await fetch(
    `https://api3.clicsante.ca/v3/establishments/${place.establishment}/schedules/public?dateStart=${startDate}&dateStop=${endDate}&service=${place.serviceId}&timezone=America/Toronto&places=${place.id}&filter1=1&filter2=0`
  ).catch(() => {
    console.error(
      `Could not get availabilities for establishmentId=${place.establishment} serviceId=${place.serviceId} placeId=${place.id}. Ignoring this establishment...`
    );
    return {};
  });

  return availabilities || [];
};

const getPlaces = async ({
  latitude,
  longitude,
  startDate,
  endDate,
  maxDistance,
  postalCode,
  tolerance,
}) => {
  let page = 0;
  let distances = {};
  let places = [];

  const spinner = ora(`Populating locations near ${postalCode}...`).start();

  while (page !== -1) {
    const result = await fetch(
      `https://api3.clicsante.ca/v3/availabilities?dateStart=${startDate}&dateStop=${endDate}&latitude=${latitude}&longitude=${longitude}&maxDistance=${maxDistance}&postalCode=${postalCode}&page=${page}&serviceUnified=237`
    );

    const { places: pagePlaces, distanceByPlaces } = result;

    if (!pagePlaces || !pagePlaces.length) {
      page = -1;
      break;
    }

    places = [
      ...places,
      ...pagePlaces.filter(
        (place) => !place.name_fr.toLowerCase().includes("astrazeneca")
      ),
    ];

    distances = { ...distances, ...distanceByPlaces };

    page += 1;
  }

  for (const place of places) {
    place.distance = distances[place.id];
  }

  // Fetch `serviceId` individually for each place. This field is required to check for availabilities.
  await Promise.all(
    places.map(async (place) => {
      place.serviceId = await getServiceId({
        establishmentId: place.establishment,
      }).catch(() => {
        console.error(
          `Could not get serviceId for establishmentId=${place.establishment}.`
        );
        return null;
      });
    })
  );

  spinner.succeed();

  return places;
};

const getPlacesWithAvailabilities = async ({
  latitude,
  longitude,
  startDate,
  endDate,
  maxDistance,
  postalCode,
  tolerance,
  specificDate,
}) => {
  const places = await getPlaces({
    latitude,
    longitude,
    startDate,
    endDate,
    maxDistance,
    postalCode,
    tolerance,
  });

  const spinner = ora(
    `Checking ${places.length} locations within ${maxDistance}km of ${postalCode} for availabilities...`
  ).start();

  await Promise.all(
    places.map(async (place) => {
      place.availabilities = await getAvailabilitiesForPlace({
        place,
        startDate,
        endDate,
      });
    })
  );

  spinner.succeed();

  return places
    .filter((place) => place.availabilities.length)
    .filter((place) =>
      specificDate
        ? place.availabilities.includes(specificDate)
        : isWithinDays(place.availabilities[0], tolerance)
    )
    .sort((a, b) => a.distance - b.distance);
};

const outputAvailabilities = async (opts) => {
  const { postalCode, distance, tolerance, specificDate } = opts;
  const startDate = moment().format("YYYY-MM-DD");
  const endDate = moment().add(100, "days").format("YYYY-MM-DD");

  const { latitude, longitude } = await getGeometry({ postalCode });

  const places = await getPlacesWithAvailabilities({
    latitude,
    longitude,
    startDate,
    endDate,
    postalCode,
    maxDistance: distance,
    tolerance,
    specificDate,
  });

  if (!places.length) return;

  for (const place of places) {
    notifier.notify({
      message: `${place.name_fr} has an availibility on ${place.availabilities[0]}`,
      sound: true,
    });

    console.log(
      boxen(
        `
${place.name_fr}
${place.formatted_address}
Distance: ${place.distance}km
Availabilities: ${place.availabilities.join(", ")}
https://clients3.clicsante.ca/${
          place.establishment
        }/take-appt?unifiedService=237&portalPlace=${
          place.id
        }&portalPostalCode=${postalCode}&lang=fr
    `,
        { padding: 1, borderStyle: "doubleSingle" }
      ),
      "\n"
    );
  }
};

const loop = async (opts) => {
  while (true) {
    await outputAvailabilities(opts);

    const spinner = ora({
      text: `Waiting ${opts.poll} minute(s) before checking again...`,
      spinner: "soccerHeader",
    }).start();

    await wait(opts.poll);

    spinner.succeed();
  }
};

const options = yargs(hideBin(process.argv))
  .option("postalCode", { type: "string", demandOption: true })
  .option("tolerance", { default: 5, type: "number" })
  .option("distance", { default: 10, type: "number" })
  .option("poll", { default: 1, type: "number" })
  .option("specificDate", { type: "string" }).argv;

loop(options);
