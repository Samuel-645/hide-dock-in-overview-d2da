'use strict';

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import {
    ExtensionPreferences,
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class HideDockPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window._settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({
            title: 'Mouse Reveal Settings',
            description: 'Customize the seek-to-reveal behavior in Overview'
        });

        // Reveal Delay
        const delayRow = new Adw.SpinRow({
            title: 'Auto-hide Delay (ms)',
            subtitle: 'Time before dock hides again after mouse reveal',
            adjustment: new Gtk.Adjustment({
                lower: 200,
                upper: 3000,
                step_increment: 100,
                page_increment: 500,
            }),
            value: window._settings.get_int('reveal-delay')
        });
        delayRow.connect('notify::value', () => {
            window._settings.set_int('reveal-delay', delayRow.value);
        });
        group.add(delayRow);

        // Mouse Threshold
        const thresholdRow = new Adw.SpinRow({
            title: 'Mouse Proximity Threshold (pixels)',
            subtitle: 'How close to the dock edge you need to move the mouse',
            adjustment: new Gtk.Adjustment({
                lower: 30,
                upper: 200,
                step_increment: 10,
            }),
            value: window._settings.get_int('mouse-threshold')
        });
        thresholdRow.connect('notify::value', () => {
            window._settings.set_int('mouse-threshold', thresholdRow.value);
        });
        group.add(thresholdRow);

        page.add(group);
        window.add(page);
    }
}