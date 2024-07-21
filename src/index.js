const { useWebSocketImplementation, Relay } = require("nostr-tools/relay");
const { npubEncode } = require("nostr-tools/nip19");
const { SimplePool } = require("nostr-tools/pool");

useWebSocketImplementation(require("ws"));

const relayUri = "wss://relay.wavlake.com";

const getTag = (event, tag) => event.tags.find((t) => t[0] === tag);

const groupBy = (items, callbackFn) => {
  const result = {};

  items.forEach((item, index, array) => {
    const key = callbackFn(item, index, array);

    if (!result[key]) {
      result[key] = [];
    }

    result[key].push(item);
  });

  return result;
};

const getZappedEvents = async (zappedEventIds) => {
  const pool = new SimplePool();
  const relays = [relayUri];
  const events = await pool.querySync(relays, { ids: zappedEventIds });

  pool.close(relays);

  return groupBy(events, ({ id }) => id);
};

const getEventAuthorNpub = (event) => npubEncode(event.pubkey);

const extractAmountInSats = (event) =>
  Number(getTag(event, "amount")[1]) / 1000;

const extractTrackId = (event) => {
  return getTag(event, "a")[1].split(":")[2];
};

const getZapEvent = (event) => {
  try {
    return JSON.parse(getTag(event, "description")[1]);
  } catch (err) {
    console.error(err);
    console.log(event);
    return null;
  }
};

const normalizeATagEvents = (zapReceiptEvents) => {
  return zapReceiptEvents.map((event) => {
    const zapEvent = getZapEvent(event);
    const zapperNpub = getEventAuthorNpub(zapEvent);
    const zapAmount = extractAmountInSats(zapEvent);
    const comment = zapEvent.content;
    const trackId = extractTrackId(zapEvent);

    return { zapperNpub, zapAmount, comment, trackId, zapReceiptId: event.id };
  });
};

const normalizeETagEvents = async (zapReceiptEvents) => {
  const getEventId = (event) => getTag(event, "e")[1];
  const zappedEvents = await getZappedEvents(
    zapReceiptEvents.map(getZapEvent).map(getEventId),
  );

  return zapReceiptEvents.map((event) => {
    const zapEvent = getZapEvent(event);
    const zapperNpub = getEventAuthorNpub(zapEvent);
    const zapAmount = extractAmountInSats(zapEvent);
    const comment = zapEvent.content;
    const trackId = extractTrackId(zappedEvents[getEventId(zapEvent)][0]);

    return { zapperNpub, zapAmount, comment, trackId, zapReceiptId: event.id };
  });
};

const start = async () => {
  const relay = await Relay.connect(relayUri);
  const numberOfEvents = 10;
  const aTagZapReceiptEvents = [];
  const eTagZapReceiptEvents = [];

  const sub = relay.subscribe(
    [
      {
        kinds: [9735],
        since: Math.floor(Date.now() / 1000) - 24 * 60 * 60, // last 24 hours
        "#p": [
          "7759fb24cec56fc57550754ca8f6d2c60183da2537c8f38108fdf283b20a0e58",
        ],
      },
    ],
    {
      onevent(event) {
        if (getTag(event, "a")) {
          aTagZapReceiptEvents.push(event);
        } else if (getTag(event, "e")) {
          eTagZapReceiptEvents.push(event);
        }
      },
      oneose() {
        normalizeETagEvents(eTagZapReceiptEvents).then((eTagResults) => {
          const results = [
            ...eTagResults,
            ...normalizeATagEvents(aTagZapReceiptEvents),
          ];

          sub.close();
          relay.close();

          results.sort((a, b) => a.zapAmount - b.zapAmount);

          results
            .slice(-numberOfEvents)
            .forEach(
              ({ zapperNpub, zapAmount, comment, trackId, zapReceiptId }) => {
                const normalizedComment =
                  comment.length === 0 ? comment : `"${comment}"\n\n`;
                const trackLink = `https://wavlake.com/track/${trackId}`;

                console.log(zapReceiptId);
                console.log(
                  `nostr:${zapperNpub} zapped ⚡️${zapAmount.toLocaleString()} sats\n\n${normalizedComment}${trackLink}\n\n\n\n`,
                );
              },
            );
        });
      },
    },
  );
};

start().catch(console.error);
