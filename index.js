const nodeFetch = require("node-fetch");
const moment = require("moment");
const notifier = require("node-notifier");
const nodeNotifier = require("node-notifier");
const ora = require("ora");
const AsciiTable = require("ascii-table");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");

const options = yargs(hideBin(process.argv))
  .option("postalCode", { type: "string", demandOption: true })
  .option("tolerance", { default: 5, type: "number" })
  .option("distance", { default: 10, type: "number" })
  .option("poll", { default: 1, type: "number" }).argv;

const wait = (minutes) =>
  new Promise((resolve) => setTimeout(resolve, minutes * 60 * 1000));

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

const getGeometry = async ({ postalCode }) => {
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
};

const getServiceId = async ({ establishmentId }) => {
  const [{ id }] = await fetch(
    `https://api3.clicsante.ca/v3/establishments/${establishmentId}/services`
  );
  return id;
};

const getAvailabilities = async ({ place, startDate, endDate }) => {
  const { availabilities } = await fetch(
    `https://api3.clicsante.ca/v3/establishments/${place.establishment}/schedules/public?dateStart=${startDate}&dateStop=${endDate}&service=${place.serviceId}&timezone=America/Toronto&places=${place.id}&filter1=1&filter2=0`
  );

  return availabilities || [];
};

let places = [];

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

  if (!places.length) {
    const spinner = ora(`Populating locations near ${postalCode}..`).start();

    while (page !== -1) {
      const result = await fetch(
        `https://api3.clicsante.ca/v3/availabilities?dateStart=${startDate}&dateStop=${endDate}&latitude=${latitude}&longitude=${longitude}&maxDistance=${maxDistance}&postalCode=${postalCode}&page=${page}&serviceUnified=237`
      );

      const { places: pagePlaces, distanceByPlaces } = result;

      if (!pagePlaces?.length) {
        page = -1;
        break;
      }

      places = [
        ...places,
        ...pagePlaces.filter(
          (place) =>
            place["name_fr"].toLowerCase().indexOf("astrazeneca") === -1
        ),
      ];

      distances = { ...distances, ...distanceByPlaces };

      page += 1;
    }

    for (const place of places) {
      place.distance = distances[place.id];
    }

    await Promise.all(
      places.map(async (place) => {
        place.serviceId = await getServiceId({
          establishmentId: place.establishment,
        });
      })
    );

    spinner.succeed();
  }

  const availabilitiesSpinner = ora(
    `Checking ${places.length} locations within ${maxDistance}km of ${postalCode} for availabilities...`
  ).start();

  await Promise.all(
    places.map(async (place) => {
      place.availabilities = await getAvailabilities({
        place,
        startDate,
        endDate,
      });
    })
  );

  availabilitiesSpinner.succeed();

  return places
    .filter(
      (place) =>
        place.availabilities.length &&
        moment(place.availabilities[0]).diff(moment(), "days") <= tolerance
    )
    .sort((a, b) => a.distance - b.distance);
};

const outputAvailabilities = async () => {
  const { postalCode, distance, tolerance } = options;
  const startDate = moment().format("YYYY-MM-DD");
  const endDate = moment().add(90, "days").format("YYYY-MM-DD");

  const { latitude, longitude } = await getGeometry({ postalCode });

  const places = await getPlaces({
    latitude,
    longitude,
    startDate,
    endDate,
    postalCode,
    maxDistance: distance,
    tolerance,
  });

  if (!places.length) return;

  for (const place of places) {
    notifier.notify({
      message: `${place.name_fr} has an availibility on ${place.availabilities[0]}`,
      sound: true,
    });

    const table = new AsciiTable();

    table
      .addRow(place.name_fr)
      .addRow(place.formatted_address)
      .addRow(`Distance: ${place.distance}km`)
      .addRow(`Availabilities: ${place.availabilities.join(", ")}`)
      .addRow(
        `https://clients3.clicsante.ca/${place.establishment}/take-appt?unifiedService=237&portalPlace=${place.id}&portalPostalCode=${postalCode}&lang=fr`
      );
    console.log(table.toString(), "\n");
  }
};

const loop = async () => {
  while (true) {
    await outputAvailabilities();

    const spinner = ora({
      text: `Waiting ${options.poll} minute(s) before checking again...`,
      spinner: "soccerHeader",
    }).start();

    await wait(options.poll);

    spinner.succeed();
  }
};

loop();
