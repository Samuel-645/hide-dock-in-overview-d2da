'use strict';

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
  Extension,
} from 'resource:///org/gnome/shell/extensions/extension.js';

export default class HideDockInOverviewD2DA extends Extension {
  enable() {
    this._settings = this.getSettings();
    this.docks = [];
    this._tempOverviewReveal = false;
    this._isCurrentlyHovering = false;
    this._overviewHideTimeout = null;

    this._findDocks();
    this._patchDocks();

    // Overview showing handler
    this._overviewShownId = Main.overview.connect('showing', () => {
      this._onOverviewShowing();
    });

    // Overview hidden handler
    this._overviewHiddenId = Main.overview.connect('hidden', () => {
      this._onOverviewHidden();
    });

    // Global stage motion handler for Overview seek
    this._stageMotionId = global.stage.connect('motion-event', (_, event) => {
      this._onOverviewMotionSeek(event);
      return Clutter.EVENT_PROPAGATE;
    });

    if (Main.overview.visible) {
      this._onOverviewShowing();
    }

    console.log('Hide Dock in Overview (Dash2Dock Animated) enabled');
  }

  disable() {
    if (this._overviewShownId) {
      Main.overview.disconnect(this._overviewShownId);
      this._overviewShownId = null;
    }
    if (this._overviewHiddenId) {
      Main.overview.disconnect(this._overviewHiddenId);
      this._overviewHiddenId = null;
    }
    if (this._stageMotionId) {
      global.stage.disconnect(this._stageMotionId);
      this._stageMotionId = null;
    }

    this._resetTimer();
    this._unpatchDocks();
    this._forceSlideInDocks();

    console.log('Hide Dock in Overview (Dash2Dock Animated) disabled');
  }

  _findDocks() {
    let docks = [];

    // Search via ExtensionManager for active Dash2Dock Animated instances
    if (Main.extensionManager && Main.extensionManager._extensions) {
      for (let [uuid, ext] of Main.extensionManager._extensions) {
        if (uuid.includes('dash') || uuid.includes('dock')) {
          if (ext.stateObj) {
            if (ext.stateObj._dock) docks.push(ext.stateObj._dock);
            if (ext.stateObj.dock) docks.push(ext.stateObj.dock);
            if (ext.stateObj._docks) docks.push(...ext.stateObj._docks);
            if (ext.stateObj._dockManager && ext.stateObj._dockManager._docks) {
              docks.push(...ext.stateObj._dockManager._docks);
            }
          }
        }
      }
    }

    if (global.dashToDock) {
      if (Array.isArray(global.dashToDock)) docks.push(...global.dashToDock);
      else docks.push(global.dashToDock);
    }

    if (Main.overview.dash && Main.overview.dash._dock) {
      docks.push(Main.overview.dash._dock);
    }

    this.docks = [...new Set(docks)].filter(Boolean);
  }

  // Intercept Dash2Dock methods at both the Dock and AutoHide levels
  _patchDocks() {
    const self = this;

    for (let dock of this.docks) {
      if (!dock) continue;

      // 1. Patch dock.slideIn
      if (dock.slideIn && !dock._originalSlideIn) {
        dock._originalSlideIn = dock.slideIn;
        dock.slideIn = function () {
          if (Main.overview.visible && !self._tempOverviewReveal) {
            return; // Block slideIn during overview unless temporary reveal is active
          }
          return dock._originalSlideIn.apply(this, arguments);
        };
      }

      // 2. Patch autoHide instance methods
      if (dock.autoHide) {
        let autoHide = dock.autoHide;

        if (!autoHide._originalCheckOverlap) {
          autoHide._originalCheckOverlap = autoHide._checkOverlap;
          autoHide._checkOverlap = function () {
            if (Main.overview.visible) {
              return !self._tempOverviewReveal;
            }
            return autoHide._originalCheckOverlap.apply(this, arguments);
          };
        }

        if (!autoHide._originalShow) {
          autoHide._originalShow = autoHide.show;
          autoHide.show = function () {
            if (Main.overview.visible && !self._tempOverviewReveal) {
              return;
            }
            return autoHide._originalShow.apply(this, arguments);
          };
        }
      }
    }
  }

  // Restore original functions
  _unpatchDocks() {
    for (let dock of this.docks) {
      if (!dock) continue;

      if (dock._originalSlideIn) {
        dock.slideIn = dock._originalSlideIn;
        delete dock._originalSlideIn;
      }

      if (dock.autoHide) {
        let autoHide = dock.autoHide;
        if (autoHide._originalCheckOverlap) {
          autoHide._checkOverlap = autoHide._originalCheckOverlap;
          delete autoHide._originalCheckOverlap;
        }
        if (autoHide._originalShow) {
          autoHide.show = autoHide._originalShow;
          delete autoHide._originalShow;
        }
      }
    }
  }

  _onOverviewShowing() {
    this._resetTimer();
    this._tempOverviewReveal = false;
    this._isCurrentlyHovering = false;

    this._findDocks();
    this._patchDocks();
    this._forceSlideOutDocks();
  }

  _onOverviewHidden() {
    this._resetTimer();
    this._tempOverviewReveal = false;
    this._isCurrentlyHovering = false;

    this._forceSlideInDocks();
  }

  _resetTimer() {
    if (this._overviewHideTimeout) {
      GLib.Source.remove(this._overviewHideTimeout);
      this._overviewHideTimeout = null;
    }
  }

  _onOverviewMotionSeek(event) {
    if (!Main.overview.visible) return;

    const [x, y] = event.get_coords();
    const monitor = Main.layoutManager.primaryMonitor;
    const threshold = this._settings ? this._settings.get_int('mouse-threshold') || 80 : 80;

    const atEdge = y > (monitor.y + monitor.height - threshold);
    const inZone = this._isPointerInDockZone(x, y);

    // Mouse near trigger edge OR inside dock
    if (atEdge || (this._tempOverviewReveal && inZone)) {
      this._isCurrentlyHovering = true;
      this._resetTimer();

      if (!this._tempOverviewReveal) {
        this._tempOverviewReveal = true;
        this._forceSlideInDocks();
      }
    } 
    // Mouse left dock area
    else if (this._tempOverviewReveal && this._isCurrentlyHovering) {
      this._isCurrentlyHovering = false;

      if (!this._overviewHideTimeout) {
        const delay = this._settings ? this._settings.get_int('reveal-delay') || 600 : 600;

        this._overviewHideTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
          this._overviewHideTimeout = null;
          if (Main.overview.visible && !this._isCurrentlyHovering) {
            this._tempOverviewReveal = false;
            this._forceSlideOutDocks();
          }
          return GLib.SOURCE_REMOVE;
        });
      }
    }
  }

  _isPointerInDockZone(x, y) {
    for (let dock of this.docks) {
      if (dock && dock._isWithinDash && dock._isWithinDash([x, y])) {
        return true;
      }
    }
    return false;
  }

  _forceSlideInDocks() {
    this.docks.forEach(dock => {
      if (!dock) return;
      let func = dock._originalSlideIn || dock.slideIn;
      if (func) {
        func.apply(dock);
      }
    });
  }

  _forceSlideOutDocks() {
    this.docks.forEach(dock => {
      if (!dock) return;
      if (dock.slideOut) {
        dock.slideOut();
      }
    });
  }
}