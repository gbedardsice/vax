const nodeFetch = require("node-fetch");
const moment = require("moment");
const notifier = require("node-notifier");
const nodeNotifier = require("node-notifier");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");

const options = yargs(hideBin(process.argv)).argv;

const wait = (minutes) =>
  new Promise((resolve) => setTimeout(resolve, minutes * 60 * 1000));

const fetch = (url, opts = {}) => {
  // console.log(`GET ${url}`);

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

const getPlaces = async ({
  latitude,
  longitude,
  startDate,
  endDate,
  maxDistance = 10,
  postalCode,
}) => {
  let page = 0;
  let places = [];

  while (page !== -1) {
    const result = await fetch(
      `https://api3.clicsante.ca/v3/availabilities?dateStart=${startDate}&dateStop=${endDate}&latitude=${latitude}&longitude=${longitude}&maxDistance=${maxDistance}&postalCode=${postalCode}&page=${page}&serviceUnified=237`
    );

    const { places: pagePlaces } = result;

    if (!pagePlaces?.length) {
      page = -1;
      break;
    }

    places = [
      ...places,
      ...pagePlaces.filter(
        (place) => place["name_fr"].toLowerCase().indexOf("astrazeneca") === -1
      ),
    ];

    page += 1;
  }

  console.log(`Found ${places.length} places.`);

  for (const place of places) {
    place.serviceId = await getServiceId({
      establishmentId: place.establishment,
    });

    place.availabilities = await getAvailabilities({
      place,
      startDate,
      endDate,
    });
  }

  return places.filter(
    (place) =>
      place.availabilities.length &&
      moment(place.availabilities[0]).diff(moment(), "days") <=
        (parseInt(options.tolerance, 10) || 5)
  );
};

const outputAvailabilities = async () => {
  const postalCode = options.postalCode;
  const startDate = moment().format("YYYY-MM-DD");
  const endDate = moment().add(90, "days").format("YYYY-MM-DD");

  const { latitude, longitude } = await getGeometry({ postalCode });

  const places = await getPlaces({
    latitude,
    longitude,
    startDate,
    endDate,
    postalCode,
  });

  for (const place of places) {
    notifier.notify({
      message: `${place.name_fr} has an availibility on ${place.availabilities[0]}`,
      sound: true,
    });

    console.log(`
      Name: ${place.name_fr}
      Address: ${place.formatted_address}
      Availabilities: ${place.availabilities.join(", ")}
      RDV: https://clients3.clicsante.ca/${
        place.establishment
      }/take-appt?unifiedService=237&portalPlace=${
      place.id
    }&portalPostalCode=${postalCode}&lang=fr
    `);
  }
};

const loop = async () => {
  while (true) {
    await outputAvailabilities();
    await wait(1);
  }
};

loop();
