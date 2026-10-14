# Team Detective Showdown — Online Project

This project includes the host game, public mobile player page, QR room invites, and a real-time Node server. Round 3 is now **Global Alcohol & Beverage Trivia** rather than Pictionary.

## Contents

- `public/index.html` — host/facilitator game; 45 questions per session, 15 per round.
- `public/player.html` — mobile answer page; players join a room and submit answers privately.
- `server.js` — room management, WebSocket answer forwarding, QR generation, and in-memory question history.
- `package.json` — Express, Socket.IO, and QR-code dependencies.

## Question variety

The offline bank has 120 unique questions: 40 Murder Mysteries, 40 Brain Teasers, and 40 Global Alcohol & Beverage Trivia questions. Every game selects 15 questions per round. The online server tracks question IDs used during its current run and prioritizes unused questions; when a round's unused bank falls below 15, it fills the set without repeating questions from the immediately previous session where possible. A server restart clears this history, because no database is configured.

## Run locally

Requirements: Node.js 18 or newer.

```bash
npm install
npm start
```

Open `http://localhost:3000` on the host computer. For phones on the same Wi-Fi, use the host computer's LAN IP address and port `3000` (not `localhost`) if the firewall permits it. For teammates on different networks, deploy the project publicly.

## Publish publicly and get the live QR code

1. Upload/extract the entire project ZIP into a Node.js hosting project (for example, Replit).
2. Run `npm install` and set the start command to `npm start`.
3. Publish/deploy it as a public web service. The host and players need the same public deployment URL.
4. Open that public URL in the host browser, register the team, and start the game.
5. Click **Mobile QR** in the game toolbar. The running server creates a QR for its actual public address and a room code.
6. Players scan the QR with their phone cameras, select their registered name, and submit A/B/C/D. Answers are forwarded privately to the host.

A usable public QR cannot be baked into the ZIP before a public URL exists. The game generates one dynamically after deployment; opening only the standalone HTML with `file://` does not provide an internet-connected room.

## Privacy and operational notes

- The facilitator's browser should stay open throughout the session.
- Player answer letters are sent only to the host. Other players see neither each other's selected options nor submitted letters.
- Rooms, player connections, and question history are stored in server memory. A server restart clears live rooms and the used-question cache.
- Room access uses a six-digit code and each player's registered name. Treat the QR as an invite for your team; this casual quiz setup is not designed as a high-security polling system.

## Reference links used in the beverage bank

- UNESCO entry on sake-making with koji mold: https://ich.unesco.org/en/RL/traditional-knowledge-and-skills-of-making-sake-with-koji-mold-in-japan-01977
- Scotch Whisky Regulations 2009: https://www.legislation.gov.uk/uksi/2009/2890/body/made
- French Cognac production decree: https://www.legifrance.gouv.fr/jorf/article_jo/JORFARTI000024198392
- Port and Douro Wines Institute overview of Port wine: https://ivdp.pt/en/wines/port-wines/introduction/
