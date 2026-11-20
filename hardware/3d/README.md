# AstroVital X - 3D-Printable Mechanical Prototypes

These are the original prototype enclosure CAD sources, printable STL parts, and accompanying assembly/preview files developed during AstroVital X.

## Designs

| Folder | Contents | Notes |
| --- | --- | --- |
| `v3.3-sensor-pocket/` | Parametric OpenSCAD model, pulse-sensor wrist pocket, retainer bezel, optional spacer, test coupon, and STL variants | Newest sensor-pocket iteration. Uses a ramped lid carried forward from the V3.2 design. |
| `v3.2-ramped-lid/` | OpenSCAD source, electronics base and ramped OLED/touch lid, test pieces, previews | Lid/board access iteration. |
| `v3.2-base-case/` | Electronics body, lid, and printed PCB retaining clips | Main enclosure components from a separate V3.2 design package. |
| `legacy-v3.1/` | Earlier parametric housing and associated print files | Historical reference, not necessarily compatible with the later V3.2/V3.3 revisions. |

## How to use

1. Open the relevant `.scad` source using [OpenSCAD](https://openscad.org/).
2. Review the accompanying Turkish assembly notes and CAD dimensions.
3. Use the supplied `.stl` models to inspect intended geometry and prepare a 3D-printer slicer project.
4. Print a **fit test** first. Verify actual PCB size, mounting holes, sensor alignment, connector clearance, battery placement, and strap fit before final assembly.

## Safety and accuracy

- **Prototype mechanical designs only.** CAD and watertight checks do not prove printability, physical fit, comfort, or durability.
- Dimensions for some sensor boards and battery packs were estimated during design. Measure the actual components before printing.
- The latest sensor-pocket iteration is not proof that the wearable is medical-grade, radiation tolerant, or suitable for EVA/spaceflight.
- Do not open, repackage, or rewire lithium-ion cells. An enclosed, commercially manufactured power bank was the intended power concept for these enclosure iterations.
- Some mechanical versions are **alternatives**, not a single guaranteed compatible assembly. Do not combine all parts indiscriminately.
- See the existing hardware and operational limitations in the root README.