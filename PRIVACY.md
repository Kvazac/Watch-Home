# Privacy

Watch Home is designed for a small private group and does not include
advertising, analytics, user accounts, or behavioral profiling.

## Data transmitted while using a watch party

The extension transmits the minimum data needed to coordinate an active party:

- a randomly generated room identifier;
- the Netflix watch identifier for the active movie or episode;
- playback position;
- play/pause and buffering state;
- playback rate;
- synchronization timestamps;
- a random host-control token used to authenticate the party host.

The host token is hashed before it is stored in the room service.

## Data not intentionally collected

Watch Home does not intentionally collect or transmit:

- Netflix passwords or authentication credentials;
- Netflix cookies;
- names or email addresses;
- subtitles, audio, or video;
- general browsing history outside the active Netflix watch page;
- advertising identifiers;
- analytics identifiers;
- device fingerprints.

## Infrastructure

Playback coordination is transported over HTTPS/WSS to Cloudflare Workers and
Durable Objects. Network infrastructure necessarily processes connection
metadata such as IP addresses, but Watch Home does not intentionally persist or
use IP addresses for application functionality or analytics.

Room state is temporary. The server schedules inactive room data for deletion
after the configured room lifetime.

Firefox extension update checks are made to the HTTPS update manifest hosted on
GitHub Pages, and signed XPI releases are downloaded from GitHub Releases.

## Mozilla data categories

The Firefox manifest declares required transmission of:

- `browsingActivity`, because the active Netflix watch identifier is sent;
- `websiteActivity`, because playback interactions and position are sent.

These declarations must be revisited before release if the implementation's
data handling changes.
