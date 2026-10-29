# Live Studio

A Windows app for going live on YouTube with your webcam, a live football scorecard and a starting-XI lineup. You can change the design and position of everything. You don't need OBS.

## Install

1. Download **LiveStudio-Windows.zip** from the [latest release](https://github.com/SOUMYAKANTA-SUNTEK/live-studio/releases/latest) and unzip it somewhere permanent, for example `Documents\Live Studio`.
2. Open the folder and double-click **Live Studio.exe**.
3. The first time, Windows may say "Windows protected your PC" because the app isn't signed yet. Click **More info**, then **Run anyway**.
4. Allow camera and microphone access if Windows asks.

## Go live

1. In **YouTube Studio**, click **Create → Go live → Stream** and copy the **Stream key**.
   (The first time, YouTube can take up to 24 hours to enable live streaming on a channel.)
2. In Live Studio, open the **Stream** tab:
   - pick your webcam and microphone (talk and watch the green level bar move)
   - paste the stream key
   - pick a quality (1080p 30 fps at 6000 kbps is a good start)
   - leave Encoder on **Light mode** (the default). It uses the least CPU and heat, and lets Windows use your graphics card. 720p is lighter still.
3. Before you go live, click **Final view** above the preview (or press `V`) to see exactly what viewers will get, without the editing outlines. **Full screen** (or `F`) shows it across the whole screen, and `Esc` exits.
4. Click the red **Go Live** button at the top right. After about 10 to 20 seconds the preview in YouTube Studio shows your stream. Your viewers see it once YouTube is set to go live (by default it starts as soon as the stream arrives).
5. Click **End stream** when you're done.

The top bar shows how long you've been live, the upload rate and the frame rate. If your internet drops, the app tries to reconnect by itself up to 5 times.

## During a match

- The − / + buttons and Start/Pause/Set in the top bar control the score and the clock. **Reset** starts a new match: it clears the score, clock, period, goals, cards, substitutions and pop-ups, but keeps your teams, lineups and design.
- **Half time** and **Full time** (Match tab) pause the clock and show HT or FT in its place.
- **Hotkeys** (when you're not typing in a box): `H` home goal, `Shift+H` undo, `J` away goal, `Shift+J` undo, `Space` start or pause the clock.
- The **Match** tab has kick-off, second-half and extra-time buttons, a period label and added time.
- **Goals and cards** (Match tab): pick the team, choose Goal, Own goal, Penalty goal, Yellow card or Red card, type or pick the player, and press **Add**. The minute fills in from the clock. Each one shows under that team's name on the scorebar with a football or card icon, e.g. "⚽ Palmer 23', 67'". Goals added here also update the score, and every goal, penalty, own goal and card also pops up on stream (like substitutions) and shows as an icon next to the player's name in the lineup. **Undo** removes one (and takes the goal off the score). Use **Clear all goals and cards** before a new match.

## Customize

- **Stream tab:** webcam fit, zoom and mirror.
- **Match tab:** team names, colours and logos.
- **Lineup tab:** lineups for both teams (starting XI and bench). Choose to show both teams switching every few seconds, or pin one team. To make a substitution, pick the team, choose who's going off, type or pick who's coming on (the minute fills in from the clock), and press **Make substitution**. The new player is marked ▲ in the lineup with ▼ and the minute for the player who went off, and a banner pops up on stream for a few seconds. Use **Undo** to fix a mistake, and **Clear all substitutions** before a new match.
- **Design tab:** themes, fonts, colours, backgrounds and row shapes.
- **Layout tab:** drag anything in the preview (including the webcam) to move it, and use the round corner handle to resize. You can also add your own text and images, and save or load a setup per match.

Everything you set up is remembered for next time.

## Studio and Broadcast layouts

On the **Design** tab, under **Layout**, click **Studio** for our own look: navy panels with angled edges and a gold accent, the scorebar across the top with team colours on its ends, the lineup on a green pitch on the left, a date and time strip top right and a full-width ticker along the bottom. You can switch the style any time with **Style** under Broadcast look, and change the main colour.

Or click **Broadcast** for a full-screen webcam look with a red glowing frame, a glossy scorebar with the clock and gameweek, a starting XI drawn as shirts on a pitch, a date card, a scrolling "Latest" ticker, an info box and a channel badge. **Classic** puts back the original layout. Everything can still be dragged and resized in the Layout tab.

- **Shirt numbers and formation:** in the Lineup tab, start each player line with the shirt number, e.g. `19 B. Mbeumo`. List the goalkeeper first, then defenders, midfielders and forwards from left to right, and pick the team's formation (4-2-3-1, 4-3-3 and so on). Substitutes, goals and cards show on the shirts.
- **Panel header:** set the sponsor line (the black strip), the subtitle ("Starting XI") and upload a QR code image in the Lineup tab.
- **Broadcast look** (Design tab): accent colour (red by default), font, frame on/off and thickness, channel badge logo and text (e.g. your subscriber count and "Subscribed"), ticker label, messages (one per line) and speed, and info box messages (one per line) with how often they change.
- **Competition:** type it in the Match tab (e.g. "Gameweek 8") to show it under the clock.
- **Pre-match:** tick **Before kick-off** in the Match tab and the scorebar shows a message like "Countdown to kick-off!" instead of the score.
- A sponsor logo can be added anywhere with **+ Image** in the Layout tab.

## Tips

- If the top bar says **falling behind**, or the laptop gets hot, use **Light mode** and **720p**, and keep the laptop plugged in on a hard surface.
- A wired internet connection is much more reliable than Wi-Fi. YouTube recommends upload speed of at least 1.5× your bitrate.
- Optional: the overlay is still available at `http://localhost:3000/overlay` while the app is open, if you ever want to use it in OBS.

## For developers

```
npm install
npm start          # run the desktop app
npm run server     # run only the overlay server in a browser
```
