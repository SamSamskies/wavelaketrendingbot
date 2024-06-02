const { useWebSocketImplementation, Relay } = require("nostr-tools/relay");
const { npubEncode } = require("nostr-tools/nip19");

useWebSocketImplementation(require("ws"));

const getTag = (event, tag) => event.tags.find((t) => t[0] === tag);

const start = async () => {
  const relayUri = "wss://relay.wavlake.com";
  const relay = await Relay.connect(relayUri);
  const events = [];
  const numberOfEvents = 10;

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
          events.push(JSON.parse(getTag(event, "description")[1]));
        }
      },
      oneose() {
        const getAmount = (event) => Number(getTag(event, "amount")[1]);

        sub.close();
        relay.close();
        events.sort((a, b) => getAmount(a) - getAmount(b));

        events.slice(-numberOfEvents).forEach((event) => {
          const zapperNpub = npubEncode(event.pubkey);
          const zapAmount = getAmount(event) / 1000;
          const comment =
            event.content.length === 0
              ? event.content
              : `"${event.content}"\n\n`;
          const trackId = getTag(event, "a")[1].split(":")[2];
          const trackLink = `https://wavlake.com/track/${trackId}`;
          console.log(
            `nostr:${zapperNpub} zapped ⚡️${zapAmount.toLocaleString()} sats\n\n${comment}${trackLink}\n\n`,
          );
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
