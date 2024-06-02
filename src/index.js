const { useWebSocketImplementation, Relay } = require("nostr-tools/relay");
const { npubEncode } = require("nostr-tools/nip19");
const { SimplePool } = require("nostr-tools/pool");

useWebSocketImplementation(require("ws"));

const relayUri = "wss://relay.wavlake.com";

const getTag = (event, tag) => event.tags.find((t) => t[0] === tag);

const getZappedEvents = async (zappedEventIds) => {
  const pool = new SimplePool();
  const relays = [relayUri];
  const events = await pool.querySync(relays, { ids: zappedEventIds });

  pool.close(relays);

  return Object.groupBy(events, ({ id }) => id);
};

const getEventAuthorNpub = (event) => npubEncode(event.pubkey);

const extractAmountInSats = (event) =>
  Number(getTag(event, "amount")[1]) / 1000;

const extractTrackId = (event) => {
  return getTag(event, "a")[1].split(":")[2];
};

const normalizeATagEvents = (aTagEvents) => {
  return aTagEvents.map((event) => {
    const zapperNpub = getEventAuthorNpub(event);
    const zapAmount = extractAmountInSats(event);
    const comment = event.content;
    const trackId = extractTrackId(event);

    return { zapperNpub, zapAmount, comment, trackId };
  });
};

const normalizeETagEvents = async (eTagEvents) => {
  const getEventId = (event) => getTag(event, "e")[1];
  const zappedEvents = await getZappedEvents(eTagEvents.map(getEventId));

  return eTagEvents.map((event) => {
    const zapperNpub = getEventAuthorNpub(event);
    const zapAmount = extractAmountInSats(event);
    const comment = event.content;
    const trackId = extractTrackId(zappedEvents[getEventId(event)][0]);

    return { zapperNpub, zapAmount, comment, trackId };
  });
};

const start = async () => {
  const relay = await Relay.connect(relayUri);
  const numberOfEvents = 10;
  const aTagZapEvents = [];
  const eTagZapEvents = [];

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
        const getParsedDescription = () =>
          JSON.parse(getTag(event, "description")[1]);

        if (getTag(event, "a")) {
          aTagZapEvents.push(getParsedDescription());
        } else if (getTag(event, "e")) {
          eTagZapEvents.push(getParsedDescription());
        }
      },
      oneose() {
        normalizeETagEvents(eTagZapEvents).then((eTagResults) => {
          const results = [
            ...eTagResults,
            ...normalizeATagEvents(aTagZapEvents),
          ];

          sub.close();
          relay.close();

          results.sort((a, b) => a.zapAmount - b.zapAmount);

          results
            .slice(-numberOfEvents)
            .forEach(({ zapperNpub, zapAmount, comment, trackId }) => {
              const normalizedComment =
                comment.length === 0 ? comment : `"${comment}"\n\n`;
              const trackLink = `https://wavlake.com/track/${trackId}`;

              console.log(
                `nostr:${zapperNpub} zapped ⚡️${zapAmount.toLocaleString()} sats\n\n${normalizedComment}${trackLink}\n\n\n\n`,
              );
            });
        });
      },
    },
  );
};

try {
  start();
} catch (err) {
  console.error(err);
}
