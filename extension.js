'use strict';

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

import {
  Extension,
} from 'resource:///org/gnome/shell/extensions/extension.js';

// Position constants matching St.Side / Dash2Dock orientation
const Position = {
  TOP: 0,
  BOTTOM: 1,
  LEFT: 2,
  RIGHT: 3,
};

export default class HideDockInOverviewD2DA extends Extension {
  enable() {
    this._settings = this.getSettings();
    this.docks = [];
    this._tempOverviewReveal = false;
    this._isCurrentlyHovering = false;
    this._overviewHideTimeout = null;
    this._dragMonitor = null;

    // Cache GSettings to avoid reading settings during mouse motion events
    this._updateCachedSettings();
    this._settingsSignalId = this._settings.connect('changed', () => {
      this._updateCachedSettings();
    });

    this._findDocks();
    this._patchDocks();
    this._enableDragMonitor();

    // Connect overview signals bound to 'this' owner
    Main.overview.connectObject(
      'showing', () => this._onOverviewShowing(),
      'hidden', () => this._onOverviewHidden(),
      this
    );

    // Track mouse motion on stage for seek-to-reveal
    global.stage.connectObject(
      'motion-event', (_, event) => {
        if (Main.overview.visible) {
          const [x, y] = event.get_coords();
          this._handlePointerMotion(x, y);
        }
        return Clutter.EVENT_PROPAGATE;
      },
      this
    );

    if (Main.overview.visible) {
      this._onOverviewShowing();
    }
  }

  disable() {
    try {
      Main.overview.disconnectObject(this);
      global.stage.disconnectObject(this);

      if (this._settings && this._settingsSignalId) {
        this._settings.disconnect(this._settingsSignalId);
        this._settingsSignalId = null;
      }

      this._disableDragMonitor();
      this._resetTimer();
      this._unpatchDocks();
      this._forceSlideInDocks();
    } catch (e) {
      console.error(`[HideDockInOverview] Error during disable: ${e.message}`);
    } finally {
      this.docks = [];
      this._tempOverviewReveal = false;
      this._isCurrentlyHovering = false;
      this._settings = null;
    }
  }

  _updateCachedSettings() {
    if (!this._settings) return;
    this._revealDelay = this._settings.get_int('reveal-delay') || 600;
    this._mouseThreshold = this._settings.get_int('mouse-threshold') || 80;
  }

  _enableDragMonitor() {
    if (this._dragMonitor) return;

    this._dragMonitor = {
      dragMotion: (dragEvent) => {
        if (Main.overview.visible) {
          this._handlePointerMotion(dragEvent.x, dragEvent.y);
        }
        return DND.DragMotionResult.CONTINUE;
      },
      dragDrop: () => {
        this._onDragEnded();
        return DND.DragMotionResult.CONTINUE;
      },
    };

    DND.addDragMonitor(this._dragMonitor);
  }

  _disableDragMonitor() {
    if (this._dragMonitor) {
      DND.removeDragMonitor(this._dragMonitor);
      this._dragMonitor = null;
    }
  }

  _onDragEnded() {
    if (Main.overview.visible && this._tempOverviewReveal) {
      this._isCurrentlyHovering = false;
      this._startTimer(this._revealDelay);
    }
  }

  _findDocks() {
    let docks = [];

    if (Main.extensionManager) {
      const targetUuids = [
        'dash2dock-lite@anaximeno',
        'dash-to-dock-animated@anaximeno',
        'dash-to-dock@micxgx.gmail.com',
        'ubuntu-dock@ubuntu.com'
      ];

      for (const uuid of targetUuids) {
        const ext = Main.extensionManager.lookup(uuid);
        if (ext && ext.stateObj) {
          if (ext.stateObj._dock) docks.push(ext.stateObj._dock);
          if (ext.stateObj.dock) docks.push(ext.stateObj.dock);
          if (Array.isArray(ext.stateObj._docks)) docks.push(...ext.stateObj._docks);
          if (ext.stateObj._dockManager && Array.isArray(ext.stateObj._dockManager._docks)) {
            docks.push(...ext.stateObj._dockManager._docks);
          }
        }
      }

      // Safe fallback scan if targeted lookup missed
      if (docks.length === 0 && Main.extensionManager._extensions) {
        for (let [uuid, ext] of Main.extensionManager._extensions) {
          if (uuid.includes('dash') || uuid.includes('dock')) {
            if (ext && ext.stateObj) {
              if (ext.stateObj._dock) docks.push(ext.stateObj._dock);
              if (ext.stateObj.dock) docks.push(ext.stateObj.dock);
              if (Array.isArray(ext.stateObj._docks)) docks.push(...ext.stateObj._docks);
              if (ext.stateObj._dockManager && Array.isArray(ext.stateObj._dockManager._docks)) {
                docks.push(...ext.stateObj._dockManager._docks);
              }
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

  _patchDocks() {
    const self = this;

    for (let dock of this.docks) {
      if (!dock) continue;

      if (typeof dock.slideIn === 'function' && !dock._originalSlideIn) {
        dock._originalSlideIn = dock.slideIn;
        dock.slideIn = function () {
          if (Main.overview.visible && !self._tempOverviewReveal) {
            return;
          }
          return dock._originalSlideIn.apply(this, arguments);
        };
      }

      if (dock.autoHide) {
        let autoHide = dock.autoHide;

        if (typeof autoHide._checkOverlap === 'function' && !autoHide._originalCheckOverlap) {
          autoHide._originalCheckOverlap = autoHide._checkOverlap;
          autoHide._checkOverlap = function () {
            if (Main.overview.visible) {
              return !self._tempOverviewReveal;
            }
            return autoHide._originalCheckOverlap.apply(this, arguments);
          };
        }

        if (typeof autoHide.show === 'function' && !autoHide._originalShow) {
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

  _startTimer(delay) {
    this._resetTimer();

    this._overviewHideTimeout = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      delay,
      () => {
        this._overviewHideTimeout = null;

        if (Main.overview.visible && !this._isCurrentlyHovering) {
          this._tempOverviewReveal = false;
          this._forceSlideOutDocks();
        }
        return GLib.SOURCE_REMOVE;
      }
    );
  }

  /**
   * Pointer motion handler with Multi-Monitor and Multi-Edge (Top/Bottom/Left/Right) support
   */
  _handlePointerMotion(x, y) {
    const monitor = Main.layoutManager.currentMonitor || Main.layoutManager.primaryMonitor;
    if (!monitor) return;

    const threshold = this._mouseThreshold || 80;
    const position = this._getPrimaryDockPosition();

    let atEdge = false;

    switch (position) {
      case Position.LEFT:
        atEdge = x < (monitor.x + threshold);
        break;
      case Position.RIGHT:
        atEdge = x > (monitor.x + monitor.width - threshold);
        break;
      case Position.TOP:
        atEdge = y < (monitor.y + threshold);
        break;
      case Position.BOTTOM:
      default:
        // Default check covers bottom edge or multi-edge proximity if position unknown
        atEdge = y > (monitor.y + monitor.height - threshold) ||
                 x < (monitor.x + threshold) ||
                 x > (monitor.x + monitor.width - threshold) ||
                 y < (monitor.y + threshold);
        break;
    }

    const inZone = this._isPointerInDockZone(x, y);

    if (atEdge || (this._tempOverviewReveal && inZone)) {
      this._isCurrentlyHovering = true;
      this._resetTimer();

      if (!this._tempOverviewReveal) {
        this._tempOverviewReveal = true;
        this._forceSlideInDocks();
      }
    } else if (this._tempOverviewReveal && this._isCurrentlyHovering) {
      this._isCurrentlyHovering = false;

      if (!this._overviewHideTimeout) {
        this._startTimer(this._revealDelay);
      }
    }
  }

  /**
   * Determine the current dock orientation / position (0=Top, 1=Bottom, 2=Left, 3=Right)
   */
  _getPrimaryDockPosition() {
    for (let dock of this.docks) {
      if (!dock) continue;

      if (typeof dock._position !== 'undefined') {
        return dock._position;
      }
      if (typeof dock.getPosition === 'function') {
        return dock.getPosition();
      }
      if (typeof dock._orientation !== 'undefined') {
        return dock._orientation;
      }
    }
    return Position.BOTTOM; // Fallback
  }

  _isPointerInDockZone(x, y) {
    for (let dock of this.docks) {
      if (!dock) continue;

      if (typeof dock._isWithinDash === 'function') {
        if (dock._isWithinDash([x, y])) return true;
      } else if (typeof dock.get_transformed_position === 'function') {
        const [dx, dy] = dock.get_transformed_position();
        const width = dock.width || 0;
        const height = dock.height || 0;

        if (x >= dx && x <= dx + width && y >= dy && y <= dy + height) {
          return true;
        }
      }
    }
    return false;
  }

  _forceSlideInDocks() {
    this.docks.forEach(dock => {
      if (!dock) return;
      let func = dock._originalSlideIn || dock.slideIn;
      if (typeof func === 'function') {
        func.apply(dock);
      } else if (typeof dock.show === 'function') {
        dock.show();
      }
    });
  }

  _forceSlideOutDocks() {
    this.docks.forEach(dock => {
      if (!dock) return;
      if (typeof dock.slideOut === 'function') {
        dock.slideOut();
      } else if (typeof dock.hide === 'function') {
        dock.hide();
      }
    });
  }
}