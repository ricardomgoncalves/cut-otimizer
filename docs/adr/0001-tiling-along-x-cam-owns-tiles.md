# Tiled Blanks go past the bed along X only, and CAM decides where the Tiles fall

A door longer than the 1300 mm bed (600 × 2000) used to be a Saw Part. The shop's CAM can already cut a file longer than the bed in several passes, so a Part bigger than the bed that has CNC ops now goes on a Tiled Blank instead. Other Parts fill the rest of the Tiled Blank. We let a Blank go past the bed along X only, which is the direction its Board's length runs, and only to hold a Part bigger than the bed, because each Tile means re-clamping and a chance of misregistration. The app writes one DXF for the whole Tiled Blank and does not model where the Tiles fall: no seams in the Plan, no clear strips at Tile edges and no seam lines on the cut sheet. The CAM owns that split, and a guessed copy of it in the app would be a second source of truth that drifts whenever the CAM's tile size or overlap changes.

## Considered Options

- **Tiling along X and Y**: rejected. Cabinet Parts bigger than the bed in both directions are rare, and with Y kept within the bed, the rest of the bed's width is free for other Parts.
- **App-planned seams** (Parts and ops kept off guessed Tile edges, a clamp strip at each one): rejected, because the CAM, not the app, decides where Tiles start.
- **One DXF per Tile**: rejected, because the CAM already does the split.
- **Tiling whenever it packs better**: rejected, because Tiles cost setup time and accuracy.
