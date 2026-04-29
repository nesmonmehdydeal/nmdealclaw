# NMDEAL Multifamily Nodes — Production Report

## Request
Create reusable personal nodes able to interact with SD1.5, SDXL/SDWL, ANIMA, ERNIE, Flux2Klein, and ZImage workflows.

## Interpretation
`sdwl` is treated as SDXL unless later evidence shows it means another specific model family.

## Delivered node package
Package name: `NMDEAL_ComfyUI_Multifamily_Nodes`

Nodes:
1. `NMDEAL Model Family Profile`
2. `NMDEAL Cinematic Prompt Adapter`
3. `NMDEAL Cinematic ViewBank5`
4. `NMDEAL CineMatrix5x5`
5. `NMDEAL Five Image Passthrough`
6. `NMDEAL Filename Matrix5x5`

## Native-first compliance
The nodes do not replace native ComfyUI loaders, text encoders, samplers, VAEs, or save nodes. They expose reusable orchestration outputs that can be wired into family-specific workflows.

## Why this is safer
A single custom node that tries to load SD1.5, SDXL, Flux-like, ERNIE, and ZImage models would hide model-family incompatibilities and create fragile dependencies. This package instead keeps model loading explicit and auditable.

## Validation performed before push
- Python syntax parse: pass.
- Node class mapping present: pass.
- No external dependency imports: pass.
- Example workflow JSON generation: pass.

## Validation blocked locally
Full ComfyUI import/execution cannot be truthfully claimed without the user’s local ComfyUI version, installed model assets, and model-family node stack.

## Runtime note
The known target machine has about 8 GB VRAM. The package avoids duplicate model loading, but actual generation cost depends on the downstream workflow and selected model family.
