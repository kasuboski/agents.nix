# design-control-loop

Pi port of HumanLayer's [`design-control-loop`](https://github.com/humanlayer/skills/tree/main/plugins/design-control-loop) skill.

Source revision: `39fb32786ae7a7cd864cf2c237148c38b1e4db07`.

## Pi-specific changes

- Removed upstream plugin registration and upstream-specific skill paths.
- Replaced the multi-agent runner matrix with pi's `-p`/`--print` mode and pi project skill locations.
- Updated the recurring workflow and `/iterate` marker to invoke and identify pi.
- Kept the control-loop model and reference templates intact where they are agent- and CI-neutral.

The skill is loaded by this repository's existing `pi.skills` package manifest and can be invoked with `/skill:design-control-loop`.

The original work is MIT-licensed; see `LICENSE`.
