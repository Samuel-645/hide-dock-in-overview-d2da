# Hide Dash2Dock Animated in Overview

A GNOME Shell extension that hides the **Dash2Dock Animated** dock while in Overview mode by default, allowing you to reveal it on demand by moving your mouse pointer near the screen edge.

## Requirements

- **GNOME Shell:** 46, 47, 48, 49, 50+
- **Required Extension:** [Dash2Dock Animated](https://extensions.gnome.org/extension/4994/dash2dock-lite/) installed and enabled.

## Features

- **Overview Autohide:** Automatically slides out and hides the Dash2Dock Animated dock when entering GNOME Overview.
- **Mouse Seek Reveal:** Move your cursor near the dock's edge on screen to temporarily reveal the dock in Overview.
- **Auto-hide Delay:** Automatically hides the dock again after a configurable timeout once your cursor leaves the dock zone.
- **Non-Invasive:** Temporarily hooks methods at runtime without modifying any files on disk.

## Installation

1. Copy or clone this extension repository to your local GNOME extensions folder:

   ```bash
   git clone [https://github.com/Samuel-645/hide-dock-in-overview-d2da.git](https://github.com/Samuel-645/hide-dock-in-overview-d2da.git) ~/.local/share/gnome-shell/extensions/hide-dock-in-overview-d2da@Samuel-645