'use strict';

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

import {
  Extension,
} from 'resource:///org/gnome/shell/extensions/extension.js';

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

    this._updateCachedSettings();
    this._settingsSignalId = this._settings.connect('changed', () => {
      this._updateCachedSettings();
    });

    this._findDocks();
    this._patchDocks();
    this._enableDragMonitor();

    Main.overview.connectObject(
      'showing', () => this._onOverviewShowing(),
      'hidden', () => this._onOverviewHidden(),
      this
    );

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
    Main.overview.disconnectObject(this);
    global.stage.disconnectObject(this);

    if (this._settingsSignalId) {
      this._settings?.disconnect(this._settingsSignalId);
      this._settingsSignalId = null;
    }

    this._disableDragMonitor();
    this._resetTimer();
    this._unpatchDocks();
    this._forceSlideInDocks();

    this.docks = [];
    this._tempOverviewReveal = false;
    this._isCurrentlyHovering = false;
    this._settings = null;
  }

  _updateCachedSettings() {
    this._revealDelay = this._settings?.get_int('reveal-delay') || 600;
    this._mouseThreshold = this._settings?.get_int('mouse-threshold') || 80;
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
    const docks = [];

    if (Main.extensionManager) {
      const targetUuids = [
        'dash2dock-lite@anaximeno',
        'dash-to-dock-animated@anaximeno',
        'dash-to-dock@micxgx.gmail.com',
        'ubuntu-dock@ubuntu.com',
      ];

      for (const uuid of targetUuids) {
        const ext = Main.extensionManager.lookup(uuid);
        if (ext?.stateObj) {
          const state = ext.stateObj;
          if (state._dock) docks.push(state._dock);
          if (state.dock) docks.push(state.dock);
          if (Array.isArray(state._docks)) docks.push(...state._docks);
          if (Array.isArray(state._dockManager?._docks)) docks.push(...state._dockManager._docks);
        }
      }

      if (docks.length === 0 && Main.extensionManager._extensions) {
        for (const [uuid, ext] of Main.extensionManager._extensions) {
          if ((uuid.includes('dash') || uuid.includes('dock')) && ext?.stateObj) {
            const state = ext.stateObj;
            if (state._dock) docks.push(state._dock);
            if (state.dock) docks.push(state.dock);
            if (Array.isArray(state._docks)) docks.push(...state._docks);
            if (Array.isArray(state._dockManager?._docks)) docks.push(...state._dockManager._docks);
          }
        }
      }
    }

    if (global.dashToDock) {
      if (Array.isArray(global.dashToDock)) docks.push(...global.dashToDock);
      else docks.push(global.dashToDock);
    }

    if (Main.overview.dash?._dock) {
      docks.push(Main.overview.dash._dock);
    }

    this.docks = [...new Set(docks)].filter(Boolean);
  }

  _patchDocks() {
    const self = this;

    for (const dock of this.docks) {
      if (dock.slideIn && !dock._originalSlideIn) {
        dock._originalSlideIn = dock.slideIn;
        dock.slideIn = function (...args) {
          if (Main.overview.visible && !self._tempOverviewReveal) return;
          return dock._originalSlideIn.apply(this, args);
        };
      }

      if (dock.autoHide) {
        const autoHide = dock.autoHide;

        if (autoHide._checkOverlap && !autoHide._originalCheckOverlap) {
          autoHide._originalCheckOverlap = autoHide._checkOverlap;
          autoHide._checkOverlap = function (...args) {
            if (Main.overview.visible) return !self._tempOverviewReveal;
            return autoHide._originalCheckOverlap.apply(this, args);
          };
        }

        if (autoHide.show && !autoHide._originalShow) {
          autoHide._originalShow = autoHide.show;
          autoHide.show = function (...args) {
            if (Main.overview.visible && !self._tempOverviewReveal) return;
            return autoHide._originalShow.apply(this, args);
          };
        }
      }
    }
  }

  _unpatchDocks() {
    for (const dock of this.docks) {
      if (dock._originalSlideIn) {
        dock.slideIn = dock._originalSlideIn;
        delete dock._originalSlideIn;
      }

      if (dock.autoHide) {
        if (dock.autoHide._originalCheckOverlap) {
          dock.autoHide._checkOverlap = dock.autoHide._originalCheckOverlap;
          delete dock.autoHide._originalCheckOverlap;
        }
        if (dock.autoHide._originalShow) {
          dock.autoHide.show = dock.autoHide._originalShow;
          delete dock.autoHide._originalShow;
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

  _handlePointerMotion(x, y) {
    const monitor = Main.layoutManager.currentMonitor || Main.layoutManager.primaryMonitor;
    if (!monitor) return;

    const threshold = this._mouseThreshold || 80;
    const position = this._getPrimaryDockPosition();

    let atEdge = false;

    switch (position) {
      case Position.LEFT:
        atEdge = x < monitor.x + threshold;
        break;
      case Position.RIGHT:
        atEdge = x > monitor.x + monitor.width - threshold;
        break;
      case Position.TOP:
        atEdge = y < monitor.y + threshold;
        break;
      case Position.BOTTOM:
      default:
        atEdge =
          y > monitor.y + monitor.height - threshold ||
          x < monitor.x + threshold ||
          x > monitor.x + monitor.width - threshold ||
          y < monitor.y + threshold;
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

  _getPrimaryDockPosition() {
    for (const dock of this.docks) {
      if (dock._position !== undefined) return dock._position;
      if (dock.getPosition) return dock.getPosition();
      if (dock._orientation !== undefined) return dock._orientation;
    }
    return Position.BOTTOM;
  }

  _isPointerInDockZone(x, y) {
    for (const dock of this.docks) {
      if (dock._isWithinDash?.([x, y])) return true;
      if (dock.get_transformed_position) {
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
      const func = dock._originalSlideIn || dock.slideIn;
      if (func) func.apply(dock);
      else dock.show?.();
    });
  }

  _forceSlideOutDocks() {
    this.docks.forEach(dock => {
      if (dock.slideOut) dock.slideOut();
      else dock.hide?.();
    });
  }
}