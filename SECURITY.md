# Security policy

Skillshelf runs commands on your computer (`claude`, `npx`, `git`) and installs its own updates, so security reports matter.

## Report a vulnerability

Please don't open a public issue. Report it privately through GitHub: on the repository's **Security** tab, choose **Report a vulnerability**. Include what an attacker could do, the steps to reproduce it, and the Skillshelf version and OS.

You'll get a reply within a week. Once a fix is released, the advisory is published with credit to you, unless you'd rather stay anonymous.

## Supported versions

Only the latest release gets security fixes. Installed copies update themselves from signed GitHub releases.

## In scope

- Running commands or opening links that the user didn't ask for, for example through crafted plugin, skill or marketplace data
- Bypassing the update signature check
- Reading or sending data that shouldn't leave the computer, such as transcripts or tokens
