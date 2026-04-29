# NMDEAL ComfyUI Multifamily Nodes

Reusable custom nodes for prompt, camera-view, profile, image-slot, and filename orchestration across several ComfyUI model families.

## Supported family targets

- SD1.5
- SDXL / SDWL interpreted as SDXL
- ANIMA
- ERNIE
- FLUX2KLEIN
- ZIMAGE

## Design principle

These nodes do not load checkpoints and do not replace native ComfyUI generation chains. They are reusable orchestration nodes:

- prompt adaptation
- camera/view prompt banks
- 5-image passthrough
- 5x5 prompt matrix
- filename matrix
- conservative family profile recommendations

The actual generation path must still use the correct native or family-specific ComfyUI chain.

## Included nodes

### NMDEAL Model Family Profile
Outputs model-family recommendations: positive prefix, negative prompt, steps, CFG, sampler, scheduler, width, height, denoise, clip skip, batch size, and audit text.

### NMDEAL Cinematic Prompt Adapter
One prompt in, one family-aware cinematic prompt out.

### NMDEAL Cinematic ViewBank5
One base prompt in, five cinematic view prompts out.

### NMDEAL CineMatrix5x5
Five base prompts in, five views selected, twenty-five positive prompts out.

### NMDEAL Five Image Passthrough
Accepts five required IMAGE inputs and returns five IMAGE outputs. No hidden resize, no mutation, no batching assumption.

### NMDEAL Filename Matrix5x5
Outputs twenty-five filename prefixes matching the 5x5 prompt matrix.

## Install

Copy this folder into:

```text
ComfyUI/custom_nodes/NMDEAL_ComfyUI_Multifamily_Nodes/
```

Expected Windows path:

```text
E:\KOUZ1\Portable_ComfyUI_Windows_NVIDIA\ComfyUI\custom_nodes\NMDEAL_ComfyUI_Multifamily_Nodes\__init__.py
```

Restart ComfyUI.

## Menu location

```text
Add Node -> NMDEAL -> Multifamily
```

## Production note

These nodes are compatible helpers, not universal inference engines. SD1.5, SDXL, ANIMA, ERNIE, FLUX2KLEIN, and ZIMAGE may require different loader, encoder, sampler, conditioning, VAE, or guidance nodes. The package avoids pretending those families share one identical backend.
