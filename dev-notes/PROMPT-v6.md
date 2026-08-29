# sviber

Your task is to develop a chart editor for Sunniesnow called sviber.

## Overview

Sunniesnow is an open-source rhythm game running on web.
The website is at <https://sunniesnow.github.io>.
The game is live at <https://sunniesnow.github.io/game-unstable>.
There is also an old version that is live at <https://sunniesnow.github.io/game>,
but do not refer to it because it is old.

The source of <https://sunniesnow.github.io> is at `..`.
It is a Jekyll project.

The source of Sunniesnow is at `../game-unstable`.
It is mostly just plain HTML and JavaScript.
There is a non-functional chart maker called sunniesnow-maker, whose source is at `../maker`.
I will ask you to copy some UI designs from Sunniesnow and sunniesnow-maker,
but ultimately you need to start from scratch,
and sviber is intended to completely replace sunniesnow-maker.
You should also follow the coding style and similar directory structures as those projects.

The chart format of Sunniesnow is documented in `../doc/chart.md`.
You are not required to implement editing every feature of this chart format.
In other words, charts that are possible to have been created by sviber are a strict subset of all possible charts accepted by Sunniesnow.
The only types of events that you need to support editing are
`tap`, `hold`, `drag`, `flick` (with only one angle), `bgNote`,
`bigText`, and all background pattern events (`grid`, `turntable` etc.).

All coordinates that are mentioned in this document are in the chart coordinate system.
For the definition of the chart coordinate system,
see `../doc/chart.md`.

## Technical notes

You will be writing plain HTML, JavaScript, and CSS.
Some parts of the editor are PixiJS apps, and you should load PixiJS v8 by fetching it from JsDelivr.
Other JS dependencies should be fetched in the same way.
The live webpage should still be usable offline by using service worker.
You can refer to Sunniesnow (`../game-unstable`) for a sample dependency and cache management.
Ignore the fact that sviber is inside a Jekyll project
(so no frontmatters).

The project will both be live on Sunniesnow's website
and be able to be used as a standalone desktop app through NW.js.
Therefore, you should also put a `package.json` file.
To make the app work offline, fetch the dependencies to `node_modules` using `npm`,
and load the dependencies from there.
Notice that `package.json` and `node_modules` will be ignored by the Jekyll site builder,
so the live webpage should still load dependencies from CDN.
Add a build script that builds the NW.js app,
and the script downloads all necessary assets (such as fonts for note texts) so that the app can work fully offline.

For some mouse dragging operations, add the mouse event listeners to `document` or `window` instead of just the canvas
because the mouse up event can be missed if the user dragged the mouse outside the canvas.

## UI elements and UX design

The UI/UX should resemble a general desktop app for content creation.

All UI/UX designs should adhere to practical purposes but not asthetic purposes.
For example, the title bar of a popup form should have bold texts to indicate that it is a title,
and the title bar should also have a gray background indicating the part of the popup menu that can be interacted to drag it by mouse.
However, the title bar should not have rounded borders or distracting colors,
which are useless from a practical point of view.
This principle of design has been reflected in Sunniesnow and sunniesnow-maker,
and you should follow it.

For any reasonable window size, you should make sure that every main UI elements (such as the menu bar and the tooltip bar) are visible without scrolling.

### Menu bar

At the top of the window, there is the menu bar.
The top level menu items are directly listed on the menu bar, including "File", "Edit", etc.

When you click a top menu item, a drop-down submenu appears with a list of submenu items.
Every top level menu item can also be accessed by using <kbd>Alt</kbd> plus some letter key as a keyboard shortcut.
One letter in the menu item should be highlighted with underline to indicate which letter key is used in the keyboard shortcut.
There is visual feedback (darken background color) when the menu item is hovered.
The drop-down submenu disappears when the user clicks elsewhere
(in which case the clicked UI element will not respond to the click if there is any element being clicked).
If the mouse cursor moves to another item on the menu bar when the submenu of one menu item is shown,
the submenu appears for the new menu item,
and the submenu disappears for the old menu item.

In the submenu, there are horizontal separators that split the items to make them look more organized.
The user can trigger submenu items by clicking with mouse.
Alternatively, the user can navigate through the submenu items through up and down arrow keys or the tab key,
and then the user can trigger a submenu item by hitting spacebar or the enter key.
Some submenu items have keyboard shortcuts that can be used to trigger it without opening the drop-down menu.
The keyboard shortcut is documented on the submenu item.
Some submenu items have an icon, and the icon is shown at the left of the item if there exists one.
There is visual feedback (darken background color) when the menu item is hovered.
A tooltip pops up when the menu item is hovered (`title` attribute of the DOM element), and the tooltip should match the one shown in the [tooltip bar](#tooltip-bar).

You should copy the UI/UX design of the menu bar from sunniesnow-maker.
You do not have to copy the exact codes, but what you produce should look similar to it.
Notice that the UX of sunniesnow-maker does not exactly match what is documented here.
You should stick to what is specified in this document.
I will refer to icon files in sunniesnow-maker later, but you need to copy them into sviber
instead of literally use the link as is.

### Tool bar

Below the menu bar is the tool bar.
Every tool bar item is shown as an icon.
Every tool bar item has a corresponding drop-down menu item that can be accessed from the menu bar,
and those menu items match their icons with the tool bar items.

When a tool bar item is hovered, the menu item text with the keyboard shortcut in parentheses pops up (`title` attribute of the DOM element),
and the tooltip bar shows the tooltip that matches the tooltip of the menu item.
Notice that the popping up text (matches menu item text plus keyboard shortcut)
and the tooltip text (matches menu item tooltip) are different.

When a tool bar item is hovered and when it is clicked, there is visual feedback in the background color.

You can copy the UX logic of the tool bar from sunniesnow-maker.
You do not have to copy the exact codes, but what you produce should look similar to it.
Notice that the UX of sunniesnow-maker does not exactly match what is documented here.
You should stick to what is specified in this document.
I will refer to icon files in sunniesnow-maker later, but you need to copy them into sviber
instead of literally use the link as is.

### Chart selection

To the right of the tool bar, there is a chart selection widget
that allows the user to switch between different charts in a project.
This widget is only present in the NW.js app, not on the webpage.
Switching charts prompts saving the current chart if there are currently unsaved changes.

### Timeline

The timeline is a PixiJS app.
It is a separate PixiJS app from the main editor field.
It includes three parts: the waveform,
the channels, and the scroll bar.
There are vertical beat lines that are shown across the waveform and the channels.
The timeline has a black background.

You can copy the UX logic of the timeline from sunniesnow-maker.
You do not have to copy the exact codes, but what you produce should look similar to it.
Notice that the UX of sunniesnow-maker does not exactly match what is documented here.
You should stick to what is specified in this document.

#### Waveform

The waveform is a graphical representation of the current music.
The waveform is shown in a gray color.
It does not overlap with the channels in space.

Each beat line at an integer beat has a beat number shown at the place of the waveform,
but the number should be small so as not to interfere with the visual appearance of the waveform.

Whenever there is a BPM change, the place where the BPM changes has a purple number to indicate the BPM.
Double clicking the BPM number can show a [popup form](#popup-form) to edit the BPM changing event.
The popup form should have identical fields as the one shown in [BPM change](#bpm-change),
but with the initial values filled with the current properties of the edited event.

There is a bright yellow vertical line shown on the waveform to indicate the current time.
Clicking or dragging on the waveform sets the current time at the mouse position, snapping to beat subdivisions.

Currently, the implementation of the waveform in sunniesnow-maker is poor in performance.
If a several minute long audio is loaded, the waveform can take a minute to be drawn.
Try to overcome this technical problem while still ensuring that the waveform can be zoomed up to visible individual samples.

#### Channels

Each channel is a series of events,
possibly being `tap`, `hold`, `drag`, `flick`, `bgNote`, `bigText`, and any one of the background patterns.
The possible events do not include BPM changes because they are not real Sunniesnow events,
and the BPM change events are shown in the [waveform](#waveform) instead of the channels.

As the total number of channels can change
(through [create channel above](#create-channel-above), [delete channel](#delete-channel), etc.),
the total height of this part should also change.
When there are more than 3 channels, do not increase the height further
but show a vertical scroll bar to scroll through the channels.

Whenever a chart is being edited in sviber, there is a special channel called the current channel.
A bright yellow vertical line is shown on only the current channel but not on other channels.

There is a horizontal line between every two adjacent channels to separate them visually.
The line should be colored dark grey so as no to be too distracting on the black background.

Every event is shown as an icon.
For `tap`, `hold`, `drag`, `flick`, and `bgNote`, just show the note body
(for `flick`, do not show the arrow part),
including the note text if there is any.
For `bigText`, use `../maker/svg/icons/create-bg-pattern.svg`.
For background patterns, devise your own design of icons, inspired from how they show up according to
`../game-unstable/js/ui/event/bg-pattern/*.js`.
For events with a duration, including `hold`, `bigText`, `bgNote`, and background patterns, show a tail to indicate the duration.
Check how Sunniesnow renders a tail for hold notes when the user setting `scroll` is `true` to inspire your design of tails.
Specially, for `bigText`, show the contents of the texts on the tail.
Notice that multiple simultaneous events may be in the same channel,
in which case their appearance should be shifted vertically so as not to completely block each other visually.
However, they should appear partially overlapping to save space.
This is UI design is similar to the timeline in the chart editor in osu!.

Events that are connected by one tip point appear connected by a thick translucent white line.
Additionally, there is an additional segment of the thick white line emanating from the first event in the tip point chain
to indicate from which direction the tip point flies in to the first event.

When the user clicks an event (including its tail if it has one),
select that event without changing the current time or the current channel.
Add the event to selection without deselecting previously selected events if the click is made while holding the <kbd>Ctrl</kbd> key.
Remoeve the event from the selection without affecting other selected events if the click is made while holding the <kbd>Alt</kbd> key.

When the user clicks somewhere on a channel without clicking an event,
the current time and the current channel is changed accordingly,
and all selected events are deselected.
This operation does not modify the selection of events.
The current time is snapped to the nearest beat subdivision instead of being literally at where the user clicks.

When the user press down the mouse left button on a channel without touching an event and drag the mouse,
a rectangular selection region is formed and visibly drawn,
and all events in the region are selected.
This does not change the current time.
The selection changes on live while the selection region changes as the user moves the mouse
until the user releases the mouse to finish selecting the events.
The drawn selection region is immediately disposed when the user releases the mouse.
Whether an event is selected is determined by whether the center of the event icon is inside the selection region.
If <kbd>Ctrl</kbd> is held while doing so, add the events to the selection without deselecting.
If <kbd>Alt</kbd> is held while doing so, remove the events from the selection.

When the user clicks somewhere on a channel while holding <kbd>Shift</kbd> key
(whether he clicks on an event or not),
change the current time and the current channel accordingly,
and also select all the events between the previous time and channel and the current time and channel.
The channel range is inclusive on both ends, and the time range is inclusive on the beginning and exclusiving on the ending.
For example, suppose that the current time is at beat 1 and that the current channel is channel 2.
Then, the user clicks at beat 5 at channel 4 while holding <kbd>Shift</kbd>.
The editor should now select all events that are in channel 2, 3, 4, and whose beat is between 1 (inclusive) and 5 (exclusive).
Add those events to the selection without deselecting previously selected events if the user is also holding <kbd>Ctrl</kbd>
Remove those events from the selection if the user is also holding <kbd>Alt</kbd>.

When only one event is selected and this event has duration,
a handle marked as a white diamond appears.
The user can use mouse to drag the handle to change the end time of the event.
The end time must be larger than the start time.
While changing it, the end time is always snapped to beat subdivision.

Selected events appear with a bright red tint.

Selected events can be dragged with mouse to be moved to other channels and time.
For moving a single event, it can be moved by the same mouse down as the click that selects the event.
If the events are moved while <kbd>Ctrl</kbd> is pressed,
make a copy of the events at the moved place
and leave the original events unchanged.

#### Beat lines

There are vertical lines that span the waveform and the channels.
Those lines indicates the position of beat subdivisions.
According to the denominator of the beat of those lines,
they are colored differently:

| Denominator | Color |
|-|-|
| 1 | red (#ff2e59) |
| 2 | blue (#3086ff) |
| 3 | green (#50a226) |
| 4 | yellow (#ff9d3d) |
| 8 | purple (#d567ff) |
| others | cyan (#00e0ad) |

Beats can be negative.

The default beat subdivision is 1/2 beats.

#### Scroll bar

The scroll bar is horizontal.
There are three major points in time that should be marked on the scroll bar:
the beginning of the visible range, the end of the visible range, and the current time.

A bright yellow vertical line indicates the current time.
The user can interact with the line using mouse to move it to other time across the music to change the current time.
During the interaction, the current time is always snapped to beat subdivisions.

Two green vertical lines indicate respectively the beginning and the end of the visible range.
The visible range is the range where the waveform and the channels are visible.
One green horizontal line connects the two vertical lines.
The user can interact with either green vertical lines to move it to change the visible range.
The user can interact with the horizontal green line to move both ends.

The mouse interaction priorities: bright yellow line > two vertical green lines > horizontal green line.

The current time can be outside the visible range.
The smallest possible value of the current time and the beginning of the visible range is the time of beat 0 or the time when the music begins, whichever is smaller.
The largest possible value of the current time and the end of the visible range is the time when the music ends
(in the edge case where there is no music loaded,
use 10 seconds after the end of the last event as the bound).

The user can also use the mouse wheel to navigate over the timeline,
which changes both the current time and the visible range by one beat subdivision.
The mouse wheel navigation works anywhere as long as the mouse is not in a scrollable DOM element.

When the user uses the mouse wheel while holding the <kbd>Ctrl</kbd> key,
the visible range shrinks/zooms in (if scrolling up) or enlarges/zooms out (if scrolling down) without changing the center of the visible range.
If the enlargement will make the visible range exceed the bounds set by the music,
change the center so that the visible range is still within bounds.

When the music is [playing](#play-pause),
the visible range and the current time change accordingly.
The current time is always at the playing progress, not snapped to beat subdivision
(this is the only case where the current time is not snapped).
When the play starts, if the current time is not in the visible range, do not move the visible range while playing;
otherwise, move the visible range while playing so that the current time marker on the waveform and the current channel does not appear moving.
If the visible range is moving while the music is playing to the point where the visible range is exceeding the music bounds, stop moving the visible range in this case.
When the music playing stops, the current time is snapped the nearest beat subdivision, and the visible range does not change.
If the user tries to change the current time by interacting with the scroll bar while the music is playing,
pause the music until the interaction finishes and restart playing from the new current time.
If the user tries to change the visible range while the music is playing,
make the change happen without interfering with the music.

### Status panel

The status panel is located to the right of the timeline.
It shows the following information:

- Time: the current time, in the format of minute, colon, second rounded to 3 decimal places.
- Beat: the current beat, in the format of integer part plus numerator slash denominator.
  The denominator is always the same as the current subdivision denominator.
  In other words, the fraction is not simplified to have coprime numerator and denominator.
- Speed: the current playback rate.

For example, it can be:

```
1:07.814
121+0/4
0.5
```

Hovering over the information gives tooltip (both `title` DOM attribute and text in the [tooltip bar](#tooltip-bar)).

The status panel can display additional information when doing some operations.
For example, when placing new events, below the usual information,
the status panel displays information
about where the new event will be placed if the user clicks the mouse now.

### Main editor field

The main editor field is a PixiJS app located below the timeline.
Both PixiJS apps should be along side the panels.

#### Background

Refer to the implementation of the background in Sunniesnow.
See `../game-unstable/js/ui/gameplay/Background.js`.

The background image should be the an image set by the user.
If the user did not set one, use pure white.
Then, take that image and blur and darken it,
according to the default settings in Sunniesnow.
Render the blurred and darkened to a texture and use that texture
instead of having a constant filter as a filter is heavy performance burden.
Note that the default white background must also be darkened, just like the "none" background handling in Sunniesnow.

#### Chart boundary

The chart boundary is a rectangle whose top left is at $(-100,50)$
and whose bottom right is at $(100,-50)$.
It is drawn with thin light gray lines.

#### Events

The events, including notes, bg notes, background patterns, and also tip points (although they are not actual events),
appear exactly like they should at the current time
as per the implementation in Sunniesnow,
including every detail of note bodies, shrinking circles, etc.
See `../game-unstable/ui/event/**/*.js` for references.
However, you do not need to make the code as complicated as Sunniesnow
because there will not be too much user settings that can tweak the appearances,
and you do not need to support `timeDependent` and `filters`.
One important point is that, when the current time is exactly at the time of an event,
render the `active` phase or `hold` phase (according to whether the event has duration)
instead of the `fadingOut` phase.

When the user clicks a note, select it.
The hit region of a note is its note body (for `hold`, not including the hold halo; for `flick`, not including the arrow),
which is a circle region
(specially, it is a hexagon region for `bgNote`).
Background patterns and `bigText` cannot be selected in this way
(the user can only select them from the [channels](#channels) in the timeline).
Clicking while holding <kbd>Ctrl</kbd> adds the note to the selection without deselecting previously selected events.
Clicking while holding <kbd>Alt</kbd> removes the note from the selection.
Selection operations are also items in the history panel, but do not add them as history items if the selection does not change.

When only one `flick` event is selected, a handle appears at the tip of its arrow.
The user can interact with the handle using the mouse to change the direction of the `flick` event.
When changing the direction in this way, it is snapped to integer multiples of $\pi/4$.

Selected events appear with a bright red tint.
Even if some selected event is not visible at the current time,
its red tint or outline is still visible to indicate that something not visible is being selected.

When there is only one movable event (i.e., note or `bgNote`)
and possibly unmovable events (i.e., `bigText` and background patterns) in the selection,
the user can drag the selected movable event with mouse to change its position.
The drag can be done by the same mouse down as the one that selects this event.
The event cannot be moved outside the chart boundary.
The movement automatically attaches the event to a snappee if it is moved near a snap point of some activated snappee.

When there is only one tip-pointable event (i.e., note) in the selection,
whose tip point spawn type is drop or chain
or which inherits a drop spawn type from a previous tip-pointable event in the channel,
then a handle appears that the user can drag using the mouse to change the spawn position.
The spawn position can snap and attach to snap points if the tip point spawn has absolute position.
If the tip point spawn has relative position,
the spawn direction is snapped to integer multiples of $\pi/12$,
and the spawn distance is snapped to integer multiples of 12.5.

When all selected movable events are attached to no snappees,
the user can move them together by dragging with mouse.
The event that the user is directly interacting with can be attached to a snappee,
but only this one event will be attached
while all other together moved events are simply placed at the moved position without attaching.
The user can move selected events again if he attaches one event in the last move
but does not change the selection or only adds non-attached events to the selection,
despite that this case does not meet the condition of all movable events being non-attached.

When all selected movable events are attached to the same rectangular mesh,
the user can move them together by dragging with mouse.
They are still attached to the mesh when being moved.

When all selected movable events are attached to the same radial mesh,
the user can move them together by dragging with mouse.
The movement is limited to rotation around the center of the radial mesh.
The events are still attached to the mesh when being moved.

When all selected movable events are attached to the same curve,
the user can move them together by dragging with mouse
by shifting them through the snap points on the curve.
They cannot be moved outside the curve because they are keep being attached to it.
However, if the curve is loop (its two ends are identified),
the movement can infinitely rotate the events along the curve.

If the user press down the mouse left button without touching an event,
make a rectangular selection region that the user can drag with the mouse to resize and that is visibly drawn.
It selects all currently visible events whose positions are inside the selection region (this does not concern the hit region of the notes).
The selection is update on live until the user releases the mouse to finish the selection.
If <kbd>Ctrl</kbd> is held, add the events to the selection without deselecting.
If <kbd>Alt</kbd> is held, remove the events from the selection.

#### Snappees

See [overview of snappees](#overview-of-snappees) to know about snappees.

Every snappee has a user-set color.
Draw the snappees with user-set color.
The lines should be thin enough so as not to distract the user.

The layer for drawing snappees is above that for the background patterns but below the notes (including `bgNote`).

For a rectangular mesh, draw a rectangular grid.
For example, if rectangular mesh is set to have 3 by 2 tiles,
then you need to draw 4 vertical line segments and 3 horizontal line segments to form a grid.
When a rectangular mesh is selected in the [snappees panel](#snappees-panel),
two handles appear, one at the top left corner and the other at the bottom right corner of the mesh.
The user can drag the handles with mouse to change the size and position of the mesh.
The handles can be snapped to other active meshes,
but they are not really attached but merely moved there.
In other words, if those other meshes are moved, the positions of the handles are not moved accordingly.
Opposed to events, the mesh handles may be moved outside the chart boundary.
Also, notice that the positions of the handles are after applying the transformation matrix,
so you need to invert the transformation matrix to actually get the correct new parameters of the snappee.
Such UX features of mesh handles are similar for other snappees,
so they are not repeated later.

For a radial mesh, draw circles and segments that connects the center to the outermost circle.
For example, if a radial mesh is set to have 3 by 2 tiles,
then you need to draw 3 line segments and 2 circles.
When a radial mesh is selected in the snappees panel,
two handles appear, one at the center, and the other at the outer end of one segment.
The user can drag the handles to change the position, size, and angle of the radial mesh.
The handles can be snapped to other meshes.

For a parametric mesh, connect every pair of nearest neighbors with straight line segments.
For example, for a parametric mesh with 3 by 4 points,
you need to draw 17 line segments:
connect $(x_{00},y_{00})$ with $(x_{10},y_{10})$ and $(x_{01},y_{01})$;
connect $(x_{11},y_{11})$ with $(x_{01},y_{01})$, $(x_{10},y_{10})$, $(x_{21},y_{21})$, and $(x_{12},y_{12})$; etc.

For a regular polygon curve, draw the regular polygon,
with dots highlighting the snap points on the sides.
Its handles are one at the center and one at a vertex.
They can be used toe change the position, direction, and size of the regular polygon.

For a B&eacute;zier curve, draw the B&eacute;zier curve,
with dots highlighting the snap points on the curve.
When it is selected in the snappees panel,
show handles at every control points of the B&eacute;zier curve
to change its shape and position.

For a circular arc curve, draw the arc,
with dots highlighting the snap points on the curve.
It has three handles, one at the center of the circle,
and two at both ends of the arc.
The one at the center can be used to move the position of the arc.
The two handles at the ends can be used to change the beginning and ending angle of the arc,
and they can only move along the circle.

For a pen curve,
draw the curve, with dots highlighting the snap points on the curve.
Its handles are all control points.

For a parametric curve,
use a broken line to connect every snap points,
with those points as nodes of the broken line.

A snappee can be double clicked to select all visible events that are attached to it.
Holding <kbd>Ctrl</kbd> while doing this adds them to the selection without deselecting.
Holding <kbd>Alt</kbd> while doing this removes them from the selection.

#### HUD

Use the same HUD as Sunniesnow,
including the top-left HUD showing the music title,
the top-right HUD showing the difficulty name and the score,
the top-center HUD showing the combo,
and the progress bar at the bottom.

Specially, since the top-center HUD has animation,
I need to address when the animation needs to be played.
It only needs to be played when the music is playing.
If the combo value changes when the music is not playing
(e.g. when the user is dragging the current time through the timeline scroll bar),
then the top-center HUD should not play its animation.

### Inspection panel

The inspection panel is below the status panel,
and shares the place with the snappees panel.
The user can click the tabs above the panel to switch between the inspection panel and the snappees panel.

The inspection panel is used for displaying and editing properties of selected events.
Depending on what events are selected, it shows different information.
When nothing is selected, this panel displays nothing.
When different types of events are selected, only the common properties are shown.
When events of different properties are selected,
the input fields in the panel are not filled with values,
but the user can edit them to bunch edit the properties of all selected events.

### Snappees panel

The snappees panel is below the status panel and shares the place with the inspection panel.
The user can switch between the two panels.

The snappees panel displays a list of all snappees in the chart.
Every snappee has a button to activate or deactivate it
(use icon `../maker/svg/icons/activate-snappee.svg` for activation
and `../maker/svg/icons/deactivate-snappee.svg` for deactivation).
Every snappee also has a button to duplicate the snappee
(add a number suffix to the name of the new snappee)
(I currently do not have an icon SVG for it, so draw one).
Every snappee also has a button to delete the snappee.
This does not delete events attached to it but simply detaches them without changing their positions.

An item in the snappies panel displays an icon and a name.
The icon is simply a zoomed-out version of the full snappee,
with the same color as the user-set color.

The user can double click a snappee in the snappees panel to open a popup form to edit the name, color, and parameters of the snappee.
If there is a sub-menu item that creates this type of snappee by showing a popup form,
the popup form is identical to the one sent by double clicking the snappees panel
except that it has additionally number inputs for the transform matrix.

Clicking an activated snappee in the snappees panel once selects it,
and this makes the main editor field show handles to edit the snappee (except the parametric snappees).
Hitting <kbd>Esc</kbd> exits this mode.

### History panel

The history panel is below the inspection panel or snappees panel.
It shows a list of edit actions.
Every time the user makes a change, a new item is added to the panel.
Older items on the panel can be clicked to undo the changes made after that item.
After undoing, the undone changes are displayed in gray
and can be clicked to redo the changes.
This panel resembles the history panel in other programs such as Photoshop.

The capacity of the history panel is 1000 records.

When saving a chart, the record in the history that gets saved gets marked with a save icon.
When auto-saving, the record in the history that gets auto-saved gets marked with an auto-save icon.
Draw the two icons yourself.

### Tooltip bar

At the bottom of the window, there is the tooltip bar.
For many UI elements,
including tool bar items, menu items, submenu items,
inspector field labels, popup form field labels,
and other buttons, when they are hovered, the tooltip bar shows texts explaining what the UI element is for.

### Popup form

A popup form is a dialogue that allows the user to enter information and then confirm or cancel with buttons.
It looks like a popup dialogue, but it is still made using DOM elements.
Sometimes the popup form does not have any input field,
in which case it just alerts the user about some information and does not actually serve the purpose of a form.
In this case, the title can be somethine like "Alert", and the contents are the actual alert message.

Most popup forms have two buttons at the bottom, one is "OK", and the other is "Cancel".
The confirm button is disabled if the input fields do not contain acceptable input.

At the top of a popup form, there is a title bar with centered text saying what this popup form is for.
The title bar can be used to drag the popup form by mouse to change its position.
The title bar should have bold text and gray background color.

For input fields in the popup forms, every one of them should have a label telling the user what this field is for,
and the user can also hover on the label to get more explanation
(as both the `title` attribute and a text showing in the [tooltip bar](#tooltip-bar)).

Sometimes part of the input should be an array of undetermined length.
In this case, there should be buttons for adding, removing, and moving array items.

When a popup form is active, the UI elements outside the popup form should be noninteractable.
The border of the popup form should flash an alarming yellow color
(while normally it just has a black border)
when the user tries to interact with other UI elements to indicate that the user should address the popup form first.

You can refer to sunniesnow-maker (`../maker`) for the design of popup forms.
You can also refer to Sunniesnow for how it specifies input data structure through HTML (`../game-unstable/index.html`).
Notice that they may not adhere strictly to the document here,
and you should not copy codes directly.

## Overview of snappees

The word "snappee" is invented to call objects that define a set of points that a positioned event can snap its position to.
There are two major types of snappees: mesh and curve.
Both of them have more subtypes that I will introduce.

From a technical point of view, a snappee is just a set of points on the plane.
When the user moves something by dragging with the mouse,
it will automatically snap the position to a snap point on the snappee
if it is close enough.
If there are multiple snap points that are close, the closest point to the mouse cursor is snapped to.

In [events creation mode](#tap-hold-drag-flick-bg-note)
or when [attaching](#attach),
snap points outside the chart boundary are not considered valid snap points that events can attach to.

The difference between a mesh and a curve is that snap points in a mesh are labeled by two indices while snap points in a curve are labeled by one index.
Specially, curves can be a loop (i.e., the first snap point identifies with the last snap point).
More generally, we can identify snap point $i$ with snap point $i+m$,
where $m$ is the number of snap points.
This is useful in some cases.
For example, when the user moves events from one snap point to another on a curve,
the events can be moved indefinitely along the curve if the curve is a closed loop;
on the ohter hand, if the curve has open ends,
the events cannot be moved past the ends.

Snappees can be transformed by some tools such as [free transform](#free-transform).
Such transformations are not implemented by directly changing the parameters of the snappees
but by composing a transformation matrix (2D affine transformation matrix with 6 degrees of freedom).
The transformation matrix can be manipulated independently of the snappee parameters.

Snappees can be active or inactive.
Inactive snappees are invisible in the main editor field,
and placing things in the main editor field does not snap to inactive snappees.

For new charts, the following snappees are created by default because they are commonly used,
and the user has the freedom to delete them.

1. Rectangular mesh from $(-100,50)$ to $(100,-50)$ with 8 by 4 tiles.
2. Radial mesh centered at $(0,0)$ with radius 50 with 16 by 4 tiles.
3. Regular hexagon centered at $(0,0)$ with radius $100/\sqrt3$, direction 0, 4 segments per side.
4. Regular hexagon centered at $(0,0)$ with radius 50, direction $\pi/2$, 4 segments per side.
5. Regular hexagon centered at $(0,0)$ with radius $50/\sqrt3$, direction 0, 2 segments per side.
6. Regular pentagon centered at $(0,20\sqrt5-50)$ with radius $100-20\sqrt5$, direction $\pi/2$, 4 segments per side.

### Rectangular mesh

The simplest snappee is the rectangular mesh.
Its parameters include the coordinates of its top left corner $(x_{00},y_{00})$,
the coordinates of its bottom right corner $(x_{mn},y_{mn})$,
the number of tiles in the horizontal direction $m$, and the number of tiles in the vertical direction $n$.

It is just a rectangular grid, and its snap points are the grid intersections
or the vertices of the tiles.
To elaborate, the snap points are
$$(x_{ij},y_{ij})=\left(x_{00}+\frac im(x_{mn}-x_{00}),y_{00}+\frac jm(y_{mn}-y_{00})\right),\quad
i=0,\ldots,m,\quad j=0,\ldots,n.$$

### Radial mesh

The radial mesh have these parameters:
the coordinates of its center $(x_{00},y_{00})$,
the radius of the outermost circle $R$,
the number of tiles in the azimuthal direction $m$,
the number of tiles in the radial direction $n$,
and the starting angle $\varphi_0$.
The snap points are
$$(x_{ij},y_{ij})=\left(x_{00}+\frac jnR\cos\!\left(\varphi_0+\frac im2\pi\right),y_{00}+\frac jnR\sin\!\left(\varphi_0+\frac im2\pi\right)\right),\quad
i=0,\ldots,m-1,\quad j=0,\ldots,n.$$

### Parametric mesh

For a parametric mesh, the expression of $x_{ij}$ and $y_{ij}$ are two user-input mathematical expressions
that can be parsed using [math.js](https://mathjs.org).

### Regular polygon curve

The regular polygon curve has the following parameters:
the coordinates of the center of the regular polygon,
the radius of the regular polygon,
the direction of one radius segment of the regular polygon specified as polar angle,
the number of sides $n$ of this regular polygon,
and the number of segments $m$ on each side.
There are totally $nm$ snap points on the sides of the regular polygon.

A regular polygon curve is naturally a closed loop.

### B&eacute;zier curve

The B&eacute;zier curve has one parameter $n$ for its degree,
$2\left(n+1\right)$ parameters for the coordinates of the control points,
and one parameter $m$ for the number of segments.
The snap points are the vertices of segments of the curve,
and the segments are determined by dividing the curve into $m$ segments with equal curve lengths.

### Pen curve

The pen curve can have many parameters.
It is the same as the curves produced by the pen tool in programs such as Inkscape.
It is composed of a bunch of connected B&eacute;zier curves
whose degrees are not larger than 3.
It has an additional parameter $m$ for the number of segments,
and the snap points are the vertices of the segments.
The segments have equal curve lengths.

[sscharter](https://github.com/sunniesnow/sscharter),
another charting tool for Sunniesnow,
has a tool to convert an SVG path to a set of points with equal curve length distance between them.
You can refer to its code, but you are encouraged to devise better algorithms.

### Parametric curve

For a parametric curve, snap points are user-input mathematical expression $(x_i,y_i)$.

## Menu items

The menu bar contains the following top-level items:

- <u>F</u>ile
- <u>E</u>dit
- E<u>v</u>ents
- <u>C</u>hannel
- <u>S</u>nappee
- <u>T</u>ransform
- <u>M</u>usic

The underlined letters are for <kbd>Alt</kbd> keyboard shortcuts.

### File

The "File" menu contains the following submenu items:

- New project... (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd>)
- New chart...
- (separator)
- Open project folder... (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd>)
- Open... (<kbd>Ctrl</kbd>+<kbd>O</kbd>)
- (separator)
- Save (<kbd>Ctrl</kbd>+<kbd>S</kbd>)
- Save as...
- (separator)
- Import chart/level file...
- Import from clipboard
- (separator)
- Export level... (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>)
- Export to clipboard
- (separator)
- Set music...
- Set background...
- (separator)
- Edit chart properties...
- (separator)
- Preferences...

#### New project...

This action creates a new sviber project.
It also opens popup form the same as that for [creating a new chart](#new-chart) to create the first chart for the project.

#### New chart...

This action creates a new chart.

If a chart is already open and has unsaved changes,
first show a popup form to ask the user whether he wants to save the current chart.
It has three buttons, "Save", "Don't Save", and "Cancel".

When creating a new chart, show a popup form.
The form asks the user to enter the following information for the new chart:

- Title
- Artist
- Charter
- Difficulty name
- Difficulty color
- Difficulty
- Difficulty superscript
- Offset
- Initial BPM

For information about most of these metadata, see `../doc/chart.md`.
However, notice that the offset here is not the offset specified in the Sunniesnow chart format
(which, as the documentation says, should be left unset in most cases).
Instead, the offset is something specific to sviber and is not useful to Sunniesnow directly.
It sets the time of beat 0 (in seconds).
Because Sunniesnow does not have the concept of beats, this is useless to Sunniesnow.
The initial BPM is literally just the initial BPM.
It is the BPM before the first BPM change event.

The difficulty color input automatically changes to a preset color if difficulty name is changed to one of "Easy", "Normal", "Hard", "Master", and "Special"
as found by `input` event listener of the text input of the difficulty name.
The user can still change the difficulty color to other values.
The preset colors are:

```
{
  easy: '#3eb9fd',
  normal: '#f19e56',
  hard: '#e75e74',
  master: '#8c68f3',
  special: '#f156ee'
}
```

The charter name is by default the same as the last time the user fills in this value
(because probably the same user writes these charts and wants to use the same name).
The difficulty name is by default "Master";
but if that difficulty already exists in the project, the difficulty name is by default "Special".
The difficulty is by default "12".
The offset is by default 0.
The initial BPM is by default 120.
The title is by default "New chart".
All other fields are by default empty, and empty inputs should be considered acceptable input.

#### Open project folder...

Open sviber project folder.
Prompt to save if there is currently unsaved changes.

#### Open...

Open sviber chart file.
Prompt to save if there is currently unsaved changes.

#### Import chart/level file...

Ask the user to select a file in the local filesystem.
Acceptable files are JSON files and .ssc files.

When handling .ssc file, show a popup form to ask the user to provide the following information:

- Chart file
- Music file
- Image file

For each of them, the available options are listed in a `<select>` DOM element for the user to select.
Available options are populated according to the contents of the .ssc file,
which is processed using [JSZip](https://stuk.github.io/jszip)
and filtered by the filename extensions.
The chart file options only include JSON files,
the music file options only include audio files,
and the image file options only include image files.
The chart file is required, but the other two files are optional.
In the case of only selecting the chart file,
it is equivalent to simply open the JSON file directly in the last file dialogue.

For handling the JSON file, see [file format](#file-format).
There are two cases: either it is already in sviber chart format,
or it is in plain Sunniesnow chart format.
In the former case, simply load the chart from the metadata and the `sviber` object in the JSON object,
ignoring the `events` array in the JSON.
In the latter case, sviber tries to import the plain Sunniesnow events as sviber events.
Most importantly, sviber events have time specified in terms of rational beat numbers,
while Sunniesnow events have time specified in float numbers in seconds,
and the plain Sunniesnow chart format does not have beat information.
Therefore, in this case, show a new popup form to ask the user to enter information to set up the beats:

- Offset
- Initial BPM
- Information of all BPM change events
- Largest denominator of beats of events

The offset and the initial BPM is the same thing as in [creating a new chart](#new).
The information of all BPM change events
is an array of BPM change events, with each event having data for the beat when the BPM change happens (in rational number)
and the BPM immediately after the BPM change.
The largest denominator sets an upper bound of the beats of the imported events.
All events are snapped to closest beat subdivisions whose denominators do not exceed the value specified here.

#### Set music..., Set background...

These two options open a file dialogue for the user to select an audio or image file as the music or background.
The audio file is decoded using [audio-decode](https://github.com/audiojs/audio-decode).

If a project is currently open, the audio or image file is copied to the project folder.

#### Save

Save the chart.
If sviber is running in NW.js app and the filesystem path of the currently open chart file is known,
then simply save the chart to local filesystem without any dialogue.
Otherwise, open a file dialogue for the user to select and save to.
The saved file format is JSON.

#### Save as...

Save the chart to local filesystem after user selects a location in a file dialogue.

#### Export level...

Generate a .ssc file and open a file dialogue to ask the user where to save it in the local filesystem.
The .ssc file contains the current chart, the current loaded music,
and the current loaded image.

#### Import from clipboard

Import JSON from clipboard as chart.
This menu item exists solely for the purpose to be a counterpart of [Export to clipboard](#export-to-clipboard).

#### Export to clipboard

Export the current chart as JSON to the clipboard.
This menu item exists because saving files to local filesystem is bugged on some browsers.

#### Edit chart properties...

Open a popup form for editing the same information asked when [creating a chart](#new)
for the currently open chart.

#### Preferences...

Open a popup form for editing sviber preferences.
The preferences are stored in `localStorage`.
It has the following fields:

- Note speed: the same option as `speed` in Sunniesnow, controlling how long the active phases of note animations are. The default value is the same as the default value in Sunniesnow.
- Allow out-of-bound events: whether the chart bound restriction of placing events is disabled. False by default.

### Edit

The "Edit" menu has the following submenu items:

- Undo (<kbd>Ctrl</kbd>+<kbd>Z</kbd>)
- Redo (<kbd>Ctrl</kbd>+<kbd>Y</kbd>)
- Cut (<kbd>Ctrl</kbd>+<kbd>X</kbd>)
- Copy (<kbd>Ctrl</kbd>+<kbd>C</kbd>)
- Paste (<kbd>Ctrl</kbd>+<kbd>V</kbd>)
- Paste with duplicated snappees (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd>)
- (separator)
- Select all (<kbd>Ctrl</kbd>+<kbd>A</kbd>)
- Select channel (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd>)
- Select none (<kbd>Ctrl</kbd>+<kbd>D</kbd>)
- Select by filter... (<kbd>Ctrl</kbd>+<kbd>F</kbd>)
- (separator)
- Delete (<kbd>Del</kbd>)

#### Undo, Redo

The undo and redo actions are equivalent to selecting one item in the past and one item in the future, respectively, in the history panel.
If there is no item in the past, grey out undo.
If there is no item in the future, grey out redo.

#### Cut, Copy, Paste

These are the clipboard operations for events.
The actual data in the clipboard are JSON.

In the clipboard data, only the beat and channel information relative to the place where they are going to be pasted matters,
but not the absolute beat and channel.
For example, assume that there is an event at beat 102 and channel 3
and an event at beat 100 and channel 4 being copied,
then the clipboard data look like this:

```
[
	{
		"beat": [2, 0, 1],
		"channel": 0,
		// ...
	},
	{
		"beat": [0, 0, 1],
		"channel": 1,
		// ...
	}
]
```

If one paste it when the current time is beat 50 and the current channel is channel 1,
then the pasted events will be one at beat 52 and channel 1
and one at beat 50 and channel 2.
Notice that how the beat and the channel information in the clipboard data
is always relative to the smallest beat and smallest channel among copied events.

#### Paste with duplicated snappees

Similar to the ordinary pasting,
but this option duplicates all snappees that at least one copied event is attached to
and attach the pasted events to newly duplicated snappees instead of the original ones.

#### Select all

Select all events in the chart.
Selection operations are also items in the history panel, but do not add them as history items if the selection does not change.

#### Select channel

Select all events in the current channel.
Selection operations are also items in the history panel, but do not add them as history items if the selection does not change.

#### Select none

Deselect all events.
Selection operations are also items in the history panel, but do not add them as history items if the selection does not change.

#### Select by filter...

Show a popup form that enters information to filter events.
After confirming the form, all and only events meeting the specified conditions are selected.

These are the available filters:

- Types (checkboxes for each type: Tap, Hold, etc.)
- Time (two rational numbers to specify a beat range)
- Text (does the note text contain this string (case insensitive)?)
- Duration (two rational numbers to specify a range of durations)
- Has simultaneous event (does this event have a simultaneous event among the following types? checkboxes for each type)

Each filter has a checkbox to specify whether this filter is enabled.
The final filter is the conjunction of all enabled filters.
The input fields of one filter are grayed out if this filter is not enabled.

Selection operation are also items in the history panel.

#### Delete

Delete selected events.

### Events

The "Events" menu has the following submenu items:

- Tap (<kbd>T</kbd>) (`../maker/svg/icons/create-tap.svg`)
- Hold (<kbd>H</kbd>) (`../maker/svg/icons/create-hold.svg`)
- Drag (<kbd>D</kbd>) (`../maker/svg/icons/create-drag.svg`)
- Flick (<kbd>F</kbd>) (`../maker/svg/icons/create-flick.svg`)
- (separator)
- Bg note (<kbd>B</kbd>) (`../maker/svg/icons/create-bg-note.svg`)
- Bg pattern... (<kbd>P</kbd>) (`../maker/svg/icons/create-bg-pattern.svg`)
- (separator)
- BPM change... (`../maker/svg/icons/bpm-change.svg`)
- (separator)
- Move to channel above (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Up</kbd>) (`../maker/svg/icons/move-to-channel-above.svg`)
- Move to channel below (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Down</kbd>) (`../maker/svg/icons/move-to-channel-below.svg`)
- (separator)
- Reverse in time
- Fill curve with drag notes

#### Tap, Hold, Drag, Flick, Bg note

If there are currently selected events (except background patterns),
convert the selected events to this event type.
For example, the user can select a bunch of events and then hit <kbd>T</kbd>,
and all of them will be converted to taps.

If there are not selected events (or if the only selected events are background patterns), then enter event creation mode.
In this mode, a translucent event sprite will appear on the main editor field, indicating where the new event will be placed.
It follows the mouse.
It is generally at the same position as where the mouse points.
If the mouse is near a snap point, then it is at the nearest snap point
(in which case the placed event will be attached to the snap point).
If the mouse is outside the chart boundary, then it is clamped at the chart boundary.
In the status panel, information about the coordinates of the new event and which snappee (if any) the new event will be attached to is displayed.
The user can do the actual placing by clicking the mouse when he deems the translucent preview to be satisfactory.
This clicking will not trigger interaction with the main editor field (events selection etc.).
After placing the event, the current selection is updated to contain only this new event.
The event creation mode does not end after this, and the user can continue placing new events.

Hitting <kbd>Esc</kbd>, trigger sub-menu items, and using the tool bar exit the event creation mode.

For hold and bg note, the default duration is the same as the last time the user creates this type of event.
If this is the first time the user creates this type of event,
then the default duration is one beat.
For flick, the default direction is the same as the last time the user creates a flick.
If this is the first time, the default direction is being upward ($\pi/2$).

#### Bg pattern...

Show a popup form to enter information.
A radio input is displayed to select one bg pattern to create among the following types:

- Big text (additionally there is text input, which is grayed out if this type is not selected)
- Grid
- Hexagon
- Checkerboard
- Diamond grid
- Pentagon
- Turntable
- Hexagram

There is additionally an input field to enter a rational number for the duration of the new event.

After the user confirms the form, a new event is created
at the current time at the current channel.

#### BPM change...

Show a popup form to enter information.
The only information to enter is the BPM number.
After that, a BPM change event is created on the timeline at the current time.
If there is already a BPM change event at the current time,
edit it instead.

Notice that although creating a BPM change event is in the "Events" menu,
normally when I say "events" in this document, it does not include BPM change events,
but only include notes, bg notes, big texts, and bg patterns.

#### Move to channel above, Move to channel below

Literally move selected events to one channel above or one channel below.
Events in different channels can be moved together.
However, "Move to channel above" should be grayed out if some events in the uppermost channel is selected,
and "Move to channel below" should be grayed out if some events in the lowermost channel is selected.
Both menu items are grayed out if no events are selected.

#### Reverse in time

Change the time of all selected events to reverse them.
To elaborate, an event originally at time $t$ becomes at time $m+M-t$,
where $m$ is the smallest time among all selected events,
and $M$ is the largest time among all selected events.

If no events are selected, this item is grayed out.

#### Fill curve with drag notes

This item is not grayed out only if a curve is currently selected from the snappees panel.
The action is to create a drag event attached to the curve for every snap point,
with the first event being at the current time,
the next event's time incrementing by one beat subdivision, etc.

### Channel

The "Channel" menu item has the following submenu items:

- Create channel above (<kbd>Insert</kbd>)
- Create channel below (<kbd>Shift</kbd>+<kbd>Insert</kbd>)
- Delete channel
- Move channel up (<kbd>Ctrl</kbd>+<kbd>Up</kbd>)
- Move channel down (<kbd>Ctrl</kbd>+<kbd>Down</kbd>)

#### Create channel above, Create channel below

Create a new channel.
Change the current channel to the new channel.

#### Delete channel

Delete the current channel along with all events in this channel.
Change the current channel to the channel above it.
This option is grayed out if the current channel is the only channel.

#### Move channel up, Move channel down

Move the current channel up or down to change the order channels.
The item "Move channel up" is grayed out if the current channel is the uppermost channel.
The item "Move channel down" is grayed out if the current channel is the lowermost channel.

### Snappee

The "Snappee" menu item contains the following submenu items:

- Rectangular mesh... (<kbd>Ctrl</kbd>+<kbd>R</kbd>) (`../maker/svg/icons/create-rectangular-mesh.svg`)
- Radial mesh... (`../maker/svg/icons/create-radial-mesh.svg`)
- Parametric mesh...
- (separator)
- Regular polygon... (`../maker/svg/icons/create-regular-polygon-mesh.svg`)
- B&eacute;zier curve (<kbd>Ctrl</kbd>+<kbd>B</kbd>) (`../maker/svg/icons/create-bezier-curve.svg`)
- Circular arc (`../maker/svg/icons/create-circular-curve.svg`)
- Pen (<kbd>Ctrl</kbd>+<kbd>P</kbd>) (`../maker/svg/icons/pen.svg`)
- Parametric curve...
- (separator)
- Activate (<kbd>A</kbd>) (`../maker/svg/icons/activate-snappee.svg`)
- Deactivate (<kbd>Shift</kbd>+<kbd>A</kbd>) (`../maker/svg/icons/deactivate-snappee.svg`)
- (separator)
- Attach (<kbd>S</kbd>) (`../maker/svg/icons/attach.svg`)
- Detach (<kbd>Shift</kbd>+<kbd>S</kbd>) (`../maker/svg/icons/detach.svg`)

#### Rectangular mesh...

Show a popup form for the user to enter information to create a new rectangular mesh.
The input fields are the following:

- Name (by default, it is `rectangular mesh {n}`, where `n` is an integer incremented automatically to avoid name collision)
- Color (by default, it is selected by rotating from a color palette)
- Top left (two numbers)
- Bottom right (two numbers)
- Tiles (two integers, horizontal count and vertical count)

#### Radial mesh...

Similar to rectangular mesh. Input fields:

- Name
- Color
- Center (two numbers)
- Radius
- Tiles (two integers, azimuthal count and radial count)

#### Parametric mesh...

Similar to rectangular mesh. Input fields:

- Name
- Color
- Range of `i`
- Range of `j`
- Expression of `x(i,j)`
- Expression of `y(i,j)`

#### Regular polygon...

Similar to rectangular mesh. Input fields:

- Name
- Color
- Center (two numbers)
- Number of sides
- Direction (polar angle of one radius segment)
- Number of segments per side

#### B&eacute;zier curve

Enters B&eacute;zier curve creation mode.
In this mode, clicking in the main editor field creates a control point for the new curve.
Already created control points can be moved by dragging with mouse.
The control points can snap (but not attach) to snappees.
Throughout the process, the new curve is drawn according to currently created control points.
To finish creating the curve, double click when creating the last control point,
or hit <kbd>Enter</kbd>.
To cancel creating the curve, hit <kbd>Esc</kbd>.
The new curve is automatically named as `bezier curve {n}`,
and the color is automatically selected by rotating through a color palette.
The last control point can also be snapped to the first control point,
in which case the creation finishes immediately
(without needing to double click or hit <kbd>Enter</kbd>),
and this new curve is set as a closed loop.

Individual control point actions are separate items in the history panel.

#### Circular arc

Enters circular arc curve creation mode.
The first click sets the center.
The second click sets one end of the arc.
While the mouse cursor moves before the second click,
a translucent circle is drawn to indicate which circle the new arc will be on.
The third click sets the other end of the arc.
The other end of the arc is at the intersection between the cirle and the segment connecting the third click and the center.
While the mouse cursor moves before the third click,
the arc is drawn to indicate what the new arc will look like.
The three control points can snap (but not attach) to snappees.
The third control points can also snap to the second control point,
in which case the arc is just a circle, and the curve is set as a closed loop.

Notice that, before the third click, how the arc change while the mouse moves must be continuous when the span angle of the arc goes through $\pi$.
Otherwise, the user cannot choose between large curve ($>\pi$) and small curve ($<\pi$).
However, the change in the arc has to be discontinuous when the span angle goes through $2\pi$.

Individual control point actions are separate items in the history panel.

#### Pen

Enters pen mode.
It is basically the same as the pen tool in Inkscape or Photoshop.
In the end, to finish the curve, either double click, hit <kbd>Enter</kbd>,
or snap the last control point to the first control point.
When the last point snaps to the first point, the curve is set as a closed loop.

Individual control point actions are separate items in the history panel.

#### Parametric curve...

Similar to rectangular mesh. Input fields:

- Name
- Color
- Range of `i`
- Expression of `x(i)`
- Expression of `y(i)`
- Whether this is a closed loop (a checkbox)

If the user checks that this is a closed loop,
then the upper bound in the range of `i` is never calculated
(no matter whether the range is inclusive or exclusive at the upper bound),
and the snap point for `i` at the upper bound is identified for `i` at the lower bound.
The expressions do not have to be periodic functions for the closed loop option to make sense.

#### Activate, Deactivate

Activate or deactivate all snappees that at least one of the selected events are attached to.
These items are grayed out if no events are selected.

#### Attach

Attach all selected events to the nearest snap points.
This generally changes their positions.
Grayed out if no events are selected or no snappees are active.

#### Detach

Detach all selected events from snappees.
This does not change their positions.
Grayed out if no events are selected.

### Transform

The "Transform" menu has the following submenu items:

- Move left (<kbd>Left</kbd>)
- Move down (<kbd>Down</kbd>)
- Move up (<kbd>Up</kbd>)
- Move right (<kbd>Right</kbd>)
- Move left by 12.5 (<kbd>Shift</kbd>+<kbd>Left</kbd>)
- Move down by 12.5 (<kbd>Shift</kbd>+<kbd>Down</kbd>)
- Move up by 12.5 (<kbd>Shift</kbd>+<kbd>Up</kbd>)
- Move right by 12.5 (<kbd>Shift</kbd>+<kbd>Right</kbd>)
- (separator)
- Flip horizontally
- Flip vertically
- Free transform (<kbd>Ctrl</kbd>+<kbd>T</kbd>) (`../maker/svg/icons/free-transform.svg`)
- Transformation matrix...
- (separator)
- Move forward (<kbd>&gt;</kbd>)
- Move backward (<kbd>&lt;</kbd>)

#### Move left, Move down, Move up, Move right, Move left by 12.5, Move down by 12.5, Move up by 12.5, Move right by 12.5

Move all selected events in space by 1 or 12.5.
This does not affect unmovable events (big texts and bg patterns).
This operation does not have any effect if an event would exceed the chart boundary.
If some events are attached to snappees,
the whole snappees are also moved (by editing their transformation matrix).
Grayed out if no events are selected.

#### Flip horizontally, Flip vertically

Transform the positions of all selected movable events by flipping about the center of the chart coordinate system.
If some events are attached to snappees,
the whole snappees are also transformed (by editing their transformation matrix).
Grayed out if no events are selected.

#### Free transform

This enters the free transform mode for selected events.
If some events are attached to snappees,
the whole snappees are also transformed (by editing their transformation matrix;
also the bounding box where the free transform control point lives should also enclose the full snappees).
This is basically the same feature as the free transform in Photoshop.
It supports translating, rotating, scaling.
Hitting <kbd>Enter</kbd> finishes and applies the transformation.
Grayed out if no events are selected.

If the bounding box of the selected events is degenerate
(for example, if the selected events are two notes with the same x coordinate, in which case the bounding box is just a vertical line
but not a 2D box),
the free transform cannot start.

When doing the free transform, the inspection panel shows numbers for the transformation matrix.

Notice that the `flick` events' directions should also change when doing the transform.
See source code of sscharter for example implementation.

#### Transformation matrix...

Show a popup form to enter information for a transformation matrix.
It is a 2D affine transform matrix, with 6 degrees of freedom,
so there are 6 input fields.
Grayed out if no events are selected.

Notice that the `flick` events' directions should also change when doing the transform.
See source code of sscharter for example implementation.

#### Move forward, Move backward

Change the time of all selected events by one beat subdivision.
Grayed out if no events are selected.

### Music

The "Music" menu has the following submenu items:

- Play/pause (<kbd>Space</kbd>) (`../maker/svg/icons/play-pause.svg`)
- (separator)
- Seek to start (<kbd>Home</kbd>) (`../maker/svg/icons/seek-to-start.svg`)
- Seek forward (<kbd>.</kbd>)
- Seek backword (<kbd>,</kbd>)
- Seek forward by 10 s (<kbd>Ctrl</kbd>+<kbd>.</kbd>)
- Seek backword by 10 s (<kbd>Ctrl</kbd>+</kbd>,</kbd>)
- (separator)
- Set subdivision to 1 beat (<kbd>1</kbd>) (`../maker/svg/icons/time-lattice-1.svg`)
- Set subdivision to 1/2 beats (<kbd>2</kbd>) (`../maker/svg/icons/time-lattice-2.svg`)
- Set subdivision to 1/3 beats (<kbd>3</kbd>) (`../maker/svg/icons/time-lattice-3.svg`)
- Set subdivision to 1/4 beats (<kbd>4</kbd>) (`../maker/svg/icons/time-lattice-4.svg`)
- Set subdivision to 1/6 beats (<kbd>6</kbd>) (`../maker/svg/icons/time-lattice-6.svg`)
- Set subdivision to 1/8 beats (<kbd>8</kbd>) (`../maker/svg/icons/time-lattice-8.svg`)
- Other subdivisions...
- (separator)
- Subtract speed by 0.1 (<kbd>[</kbd>)
- Add speed by 0.1 (<kbd>]</kbd>)
- Set speed to 0.25 (`../maker/svg/icons/speed-0-25.svg`)
- Set speed to 0.5 (`../maker/svg/icons/speed-0-5.svg`)
- Set speed to 1 (<kbd>\\</kbd>) (`../maker/svg/icons/speed-1.svg`)
- (separator)
- Zoom in (<kbd>Ctrl</kbd>+<kbd>=</kbd>) (`../maker/svg/icons/zoom-in.svg`)
- Zoom out (<kbd>Ctrl</kbd>+<kbd>-</kbd>) (`../maker/svg/icons/zoom-out.svg`)

#### Play/pause

Play or pause the music playback.

When playing, the sound effects of the notes also play.
Check `../game-unstable/js/audio/se/SeWithMusic.js` to see how to make the sound effects perfectly in sync with the music.

This menu item is still functional even if there is no music loaded.
In this case, only the note sound effect plays.

When the music is playing, also play note hit effects. Check `../game-unstable/js/ui/fx/*.js` for implementation.
The note hit effects should align with the one in Sunniesnow.
The hit effects does not pause when the music pauses.

While music is playing, because the current time is not snapped to beat subdivisions,
many editor functions should be disabled.
You need to gray out most of them.
However, all the submenu items in "Music" menu should still be enabled while music is playing.
In other words, the user can seek forward or backward
and set the playback rate while the music is playing.

#### Seek to start

If the music is playing, change the current time to music beginning or beat 0, whichever is smaller.
If the music is not playing, change the current time to the beat subdivision closest to the music beginning or beat 0,
whichever is smaller.
Change the visible range of the timeline to contain the current time.

#### Seek forward, Seek backword

Increment or decrement the current time by 1 beat subdivision.
This is equivalent to using the mouse scroll wheel.

#### Seek forward by 10 s, Seek backword by 10 s

Increment or decrement the current time by 10 seconds.
If the music is not playing, snap to the closest beat subdivision.

#### Set subdivision to 1 beat, Set subdivision to 1/2 beats, Set subdivision to 1/3 beats, Set subdivision to 1/4 beats, Set subdivision to 1/6 beats, Set subdivision to 1/8 beats

Change the current beat subdivision.

#### Other subdivisions...

Open a popup form for the user to set a beat subdivision.
It allows the user to input a positive integer $n$, and the beat subdivision is set to $1/n$ beats.

#### Subtract speed by 0.1, Add speed by 0.1

Decrease or increase the playback rate by 0.1.

#### Set speed to 0.25, Set speed to 0.5, Set speed to 1

Directly set the playback rate.

#### Zoom in, Zoom out

Change the visible range of the timeline.
This is equivalent to use mouse scroll wheel while holding <kbd>Ctrl</kbd>.

## Tool bar items

The tool bar contains the following items.
Every item has the exact same icon and function as its menu item counterpart.

- Tap (Events)
- Hold (Events)
- Drag (Events)
- Flick (Events)
- Bg note (Events)
- Bg pattern... (Events)
- BPM change... (Events)
- (separator)
- Move to channel above (Events)
- Move to channel below (Events)
- Create channel above (Channels)
- Create channel below (Channels)
- Delete channel (Channels)
- Move channel up (Channels)
- Move channel down (Channels)
- (separator)
- Rectangular mesh... (Snappee)
- Radial mesh... (Snappee)
- Regular polygon... (Snappee)
- B&eacute;zier curve (Snappee)
- Circular arc (Snappee)
- Pen (Snappee)
- Activate (Snappee)
- Deactivate (Snappee)
- Attach (Snappee)
- Detach (Snappee)
- (separator)
- Free transform (Transform)
- (separator)
- Play/pause (Music)
- Seek to start (Music)
- Set subdivision to 1/2 beats (Music)
- Set subdivision to 1/4 beats (Music)
- Set speed to 0.25 (Music)
- Set speed to 0.5 (Music)
- Set speed to 1 (Music)
- Zoom in (Music)
- Zoom out (Music)

## Event types

This section explains all parameters that are available in the inspection panel for each type of event.

When a position is attached to a snappee, an icon identical to the one shown in the snappees panel is shown
to indicate which snappee it is attached to.

### Tap

- Time (rational number in beats)
- Position (two numbers); not editable if attached to a snappee
- Text
- Tip point mode (see [tip points](#tip-points))

### Hold

- Time (rational number in beats)
- Position (two numbers); not editable if attached to a snappee
- Duration (rational number in beats, cannot be zero)
- Text
- Tip point mode (see [tip points](#tip-points))

### Drag

- Time (rational number in beats)
- Position (two numbers); not editable if attached to a snappee
- Tip point mode (see [tip points](#tip-points))

### Flick

- Time (rational number in beats)
- Position (two numbers); not editable if attached to a snappee
- Direction (zero is to the right, counterclockwise)
- Text
- Tip point mode (see [tip points](#tip-points))

### Bg note

- Time (rational number in beats)
- Position (two numbers); not editable if attached to a snappee
- Duration (rational number in beats, can be zero)
- Text

### Big text

- Time (rational number in beats)
- Duration (rational number in beats, cannot be zero)
- Text

### Grid, Hexagon, Checkerboard, Diamond grid, Pentagon, Turntable, Hexagram

- Time (rational number in beats)
- Duration (rational number in beats, cannot be zero)

## Tip points

In sviber, there is no placeholder event, which is used in Sunniesnow for constructing arbitrary tip point paths.
Therefore, the tip point patterns that can be created in sviber is a strict subset of what Sunniesnow supports.
The only events that can be connected by a tip point are tap, hold, drag, and flick (i.e., all note events).
Note that bg notes are not tip-pointable in sviber although Sunniesnow supports connecting them with tip points.
Such events are called tip-pointable events.

Every tip-pointable event has some parameters that control how they are connected by tip points,
and the collection of those parameters are called the tip point mode of an event.
The tip point mode consists of the following parameters:

- Spawn type
- Absolute spawn position (two numbers; not editable if attached)
- Relative spawn position (two numbers, one number for distance and the other for direction)
- Time in seconds (one number)
- Time in beats (one rational number)

Radio inputs are used for choosing one from absolute and relative spawn positions.
Only one of them can be used, and the input fields of the other are disabled.
Radio inputs are used for choosing one from time in seconds and beats.
Only one of them can be used, and the input fields of the other are disabled.

When saving as Sunniesnow chart,
a placeholder event is generated for spawning the tip point.

### Tip point spawn type

The tip point spawn type is one of "inherit", "chain", "drop", and "none".
The default is "inherit".

If a tip-pointable event has the inherit spawn type, then:

- If the previous tip-pointable event in its channel has the chain spawn type,
  then this event is connected by the same tip point as the previous tip-pointable event.
- If the previous tip-pointable event in its channel has the drop spawn type,
  then this event is connected by a new tip point with the same spawn parameters (position and time) as the previous tip-pointable event.
- If this event is the first tip-pointable event in the channel
  or if the previous tip-pointable event has the none spawn type,
  then this event is not connected by a tip point.

If the next tip-pointable event in the channel also has the inherit spawn type,
then it sees the tip point spawn type of this event as the same spawn type of the previous tip-pointable event in the channel.

For example, suppose that the tip-pointable events in a channel have the following spawn types:
(1) inherit, (2) chain, (3) inherit, (4) inherit, (5) drop, (6) inherit, (7) inherit, (8) none, (9) inherit.
Then, the events 1, 8, and 9 are not connected by tip points.
The events 2, 3, and 4 are connected by the same tip point.
The events 5, 6, and 7 are connected by separate tip points
with the same spawn parameters.

The spawn types are inspired by [sscharter](https://github.com/sunniesnow/sscharter).
Read its source code for more information.

There is the edge case of multiple simultaneous tip-pointable events being in the same channel,
in which case it is hard to determine which one is previous and which one is next.
Just ignore this quirk and take whatever order that is already present in the data structure as the order of the simultaneous events.
Depending on the order of simultaneous events in the same channel for tip point behaviors
is undefined behavior,
and users are discouraged to do that.

### Spawn position

The spawn position can either be absolute or relative.

The absolute spawn position is either directly the coordinates that set where the tip point will spawn,
or attached to a snappee for the position.

The relative spawn position is set by the distance and direction of the spawn.
This specifies the spawn position relative to the first event that the tip point connects to.
For example, if the spawn position is 100 with the direction of $\pi/2$,
then it spawns above its first event with 100 distance from it.

The default spawn position is relative, 100, $\pi/2$.

### Spawn time

The spawn time specifies when the tip point spawns.
It can either be specified in seconds or specified in beats.
For example, if it is set to 1 second, then the tip point spawns at 1 second before the time of the first event that it connects to.
If it is set to 2 beats, then the tip point spawns at 2 beats before the time of the first event that it connects to.

The default spawn time is 1 second.

## File format

The file format saved by sviber is an extension to Sunniesnow's chart file format.
Sunniesnow's chart file format is documented in `../doc/chart.md`.
As an extension, the sviber chart format has an additional key at the top-level JSON object called `sviber`,
which is an object containing all the information that is required for charting using sviber
(except some metadata, including `title` etc., which are simply present in the original Sunniesnow chart format).

The JSON object under the key `sviber` is an object containing the following properties:

- `music`: the path to the music file.
- `image`: the path to the image file (often used as background).
- `editor`: an object containing information of editor status that does not relate to the actual chart,
  such as the current time and the current channel.
- `timing`: an object containing timing information, such as offset and BPM.
- `channels`: an array of objects containing information of channels.
- `events`: an array of objects containing information of events,
  including notes, `bgNote` events, and background patterns.
- `snappees`: an array of objects containing information of snappees.

When saving a chart using sviber,
the top level `events` field will be generated to ensure Sunniesnow compatibility.
That field is useless for sviber.

Sometimes one needs to represent a rational number in JSON.
It is represented as a 3-tuple of numbers,
the 3 numbers respectively being the integer part, the numerator of the frational part,
and the denominator of the fractional part.

This file format may not be optimal. Improve it if you think you have better ideas.

### `music` field and `image` field

These two fields are file paths in the local filesystem.
They are useless on the live webpage because normal browser does not allow accessing local files.
However, for the NW.js app, there is API for accessing local files.
In this case, loading chart with this information will automatically load specified music file and image file.

### `editor` field

A JSON object with the following fields:

- `timeSnapped`: whether the current time is snapped to subdivisions.
- `subdivision`: the current subdivision, a positive integer. Integer $n$ means that the subdivision is $1/n$.
- `currentTime`: either a float number if `timeSnapped` is false or a rational number 3-tuple denoting the current time in beats.
- `visibleRangeBeginning`: float number indicate the visible range start.
- `visibleRangeEnd`: float number indicate the visible range end.
- `speed`: playback rate.

### `timing` field

A JSON object with the following fields:

- `offset`: float number, time of beat 0.
- `initialBpm`: initial BPM, the BPM before the first BPM change.
- `bpmChanges`: an array of BPM change events.

Each BPM change event is a JSON object with the following fields:

- `time`: rational 3-tuple representing time in beats.
- `bpm`: float number for the BPM value.

### `channels` field

An array of channels. Each channel is a JSON object with the following fields

- `id`: an integer ID number. It increments starting from 0, to distinguish different channels.

When moving channels around (e.g., [move channel up and move channel down](#move-channel-up-move-channel-down)),
the ID number of the channels do not change,
but they only change order in this array.

### `events` field

An array of events.
Each event is a JSON object with the following fields (nonexhaustive):

- `type`: string, one of `tap`, `hold`, `flick`, `drag`, `bgNote`,`bigText`,
  `grid`, `hexagon`, `checkerboard`, `diamondGrid`, `pentagon`, `turntable`, `hexagram`.
- `time`: rational number 3-tuple indicating the time in beats.
- `selected`: boolean, whether it is selected.
- `channel`: channel ID number.

Other fields depend on the type.

Movable events (`tap`, `hold`, `flick`, `drag`, `bgNote`) have these fields:

- `attached`: boolean, whether attached to a snappee.
- `x`: x coordinate, present if `attached` is false.
- `y`: y coordinate, present if `attached` is false.
- `snappee`: snappee ID number indicating which snappee it is attached to, present if `attached` is true.
- `snapPoint`: either one number `i` if the snappee is a curve,
  or two numbers `[i,j]` if the snappee is a mesh; present if `attached` is true.

Events with durations (`hold`, `bgNote`, `bigText`,
`grid`, `hexagon`, `checkerboard`, `diamondGrid`, `pentagon`, `turntable`, `hexagram`)
have these fields:

- `duration`: rational 3-tuple denoting the duration in beats.

Events with texts (`tap`, `hold`, `flick`, `bgNote`, `bigText`) have these fields:

- `text`: arbitrary string for the text.

`flick` events have these fields:

- `angle`: direction denoted as an angle in radians.

Tip-pointable events (`tap`, `hold`, `drag`, `flick`) have these fields:

- `tipPointSpawnType`: string, one of `inherit`, `chain`, `drop`, `none`.
- `tipPointSpawnAbsolutePosition`: boolean.
- `tipPointSpawnAttached`: boolean, present if `tipPointSpawnAbsolutePosition` is true.
- `tipPointSpawnX`: x coordinate of spawn position,
  present if `tipPointSpawnAttached` is present and false.
- `tipPointSpawnY`: y coordinate of spawn potision,
  present if `tipPointSpawnAttached` is present and false.
- `tipPointSpawnSnappee`: snappee ID,
  present if `tipPointSpawnAttached` is present and true.
- `tipPointSpawnSnapPoint`: either one number `i` if the snappee is a curve,
  or two numbers `[i,j]` if the snappee is a mesh;
  present if `tipPointSpawnAttached` is present and true.
- `tipPointSpawnDistance`: number for the spawn distance,
  present if `tipPointSpawnAbsolutePosition` is false.
- `tipPointSpawnAngle`: number for spawn direction, angle in radians,
  present if `tipPointSpawnAbsolutePosition` is false.
- `tipPointSpawnTimeBeats`: boolean.
- `tipPointSpawnTime`: either rational 3-tuple specifying relative spawn time in beats if `tipPointSpawnTimeBeats` is true,
  or a float number specifying in seconds otherwise.

### `snappees` field

An array of snappees.
Each snappee is a JSON object with the following fields:

- `id`: ID number.
- `name`: user-set name.
- `color`: color in CSS hash plus hex format.
- `type`: string, one of `rectangularMesh`, `radialMesh`, `parametricMesh`,
  `regularPolygonCurve`, `bezierCurve`, `circularArcCurve`, `penCurve`, `parametricCurve`.
- `transformation`: a 6-number array denoting an affine transformation matrix.
- `active`: boolean, whether it is active.
- `selected`: boolean, whether it is selected.

Other fields depend on the type.

For rectangular mesh:

- `topLeftX`: top left x coordinate.
- `topLeftY`: top left y coordinate.
- `bottomRightX`: bottom right x coordinate.
- `bottomRightY`: bottom right y coordiante.
- `horizontalTiles`: number of tiles in x direction.
- `verticalTiles`: number of tiles in y direction.

For radial mesh:

- `centerX`
- `centerY`
- `radius`
- `azimuthalTiles`
- `radialTiles`

For parametric mesh:

- `iRange`: array of two integers indicating the range of `i`.
- `iRangeExclusive`: boolean, whether the upper bound of `iRange` is exclusive.
- `jRange`
- `jRangeExclusive`
- `xExpression`: string of mathematical expression.
- `yExpression`

For regular polygon curve:

- `centerX`
- `centerY`
- `angle`
- `radius`
- `segmentsPerSide`

For B&eacute;zier curve:

- `degree`
- `controlPoints`: array of `{x:,y:}` objects.
- `segments`: integer, number of segments.

For circular arc curve:

- `centerX`
- `centerY`
- `radius`
- `closed`: boolean, whether a closed loop.
- `beginningAngle`
- `endAngle`: only present if `closed` is false.
- `clockwise`: whether the arc is drawn from beginning angle to the end angle in the clockwise direction.
- `segments`

For pen curve:

- `commands`: the curve commands. You invent your own data structure. Make it readable by human as possible.
- `segments`
- `closed`: depending on how you decide the data structure for `commands`, this field may be unnecessary.

For parametric curve:

- `iRange`
- `iRangeExclusive`
- `xExpression`
- `yExpression`
- `closed`

## Miscellaneous

### Project folder

Anything related to the whole project is only available in the standalone NW.js app but not on the webpage.
On the webpage, only one chart at a time can be edited and opened.
On the standalone app, one project can be opened.
A project is a folder that contains possibly multiple charts
and audio files and image files.
The user can export a project folder to Sunniesnow level as .ssc file
including all charts.
On the webpage, exported Sunniesnow level only has one chart.

### Internationalization

Full internationalization support for every DOM text should be supported.
If the browser `nagivator.language` is Chinese, use zh-CN as the display language.
Otherwise use en-US.
Currently only these two languages are required to be supported.

### Auto-save

Every minute, automatically save the chart currently being edited to `localStorage`
if there is unsaved changes.
Whenever the user saves the change using [Save](#save) menu action,
record it.
Whenever the user opens sviber, show a popup form asking whether the user wants to load the last auto-save
if there is no manual save record after the last auto-save.
If there are more than one auto-saves,
list all of them with save time and titles to ask the user which one to open.

Normally, do not delete previous auto-saves.
However, delete the oldest ones if `localStorage` is too occupied to have new data saved.

### Dynamic page title

The page title is dynamically set in the format of
`${title} ${difficultyName} - sviber`.
Add `* ` at the beginning if there is unsaved change.

### Dark theme

Use most basic CSS to support dark theme using `prefers-color-scheme`.
See `../game-unstable/css/style.css` for reference.

Only concern the dark theme for DOM elements.
Do not worry about contents inside PisiJS apps.

### Number input

Number input is common in many popup forms.

Nonnegative rational numbers are used for beat numbers.
A rational number should be input using three integer input fields,
meaning the integer part and the numerator and the denominator of the fractional part.
The HTML can be `<input>+<input>/<input>`.

Number input for coordinates should generally accept mathematical expressions.
They are parsed by math.js.

Number input for angles should have an accompanying checkbox for whether radians mode is on.
The radians mode should be off by default.
In either case, the number input should accept math expressions.

Range input for integer parameters (for creating and editing parametric snappees) consists of two integer number inputs.
There should also be an accompanying checkbox to choose whether the upper bound is inclusive or exclusive.
It should be exclusive by default.
