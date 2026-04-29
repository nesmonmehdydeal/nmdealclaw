# NMDEAL_ComfyUI_Multifamily_Nodes
# Reusable model-family orchestration nodes for ComfyUI.
# Native-first policy: no checkpoint loading, no hidden model substitution.

class NMDEALBase:
    CATEGORY = "NMDEAL/Multifamily"
    FAMILIES = ["SD1.5", "SDXL", "ANIMA", "ERNIE", "FLUX2KLEIN", "ZIMAGE"]
    QUALITY_MODES = ["low_vram_8gb", "balanced", "quality"]
    TASKS = ["txt2img", "img2img", "inpaint", "image_edit", "reference_edit"]
    ASPECTS = ["1:1", "3:2", "2:3", "16:9", "9:16", "4:3", "3:4"]
    VIEW_PRESETS = [
        "01 Right45 / Medium / 35mm / Eye Level",
        "02 Left45 / Medium / 35mm / Eye Level",
        "03 Push-In / Close-up / 50mm / Eye Level",
        "04 Pull-Back / Full Body / 35mm / Low Angle",
        "05 Orbit Right / Full Body / 24mm / Eye Level",
        "06 Orbit Left / Full Body / 24mm / Eye Level",
        "07 Pan Right / Medium / 50mm / Eye Level",
        "08 Pan Left / Medium / 50mm / Eye Level",
        "09 Wide Establishing / 24mm / High Angle",
        "10 Extreme Close-up / 85mm / Eye Level",
        "11 Hero Low-Angle / Full Body / 35mm",
        "12 Top-Down / Medium / 24mm",
        "13 Dutch Tilt / Medium / 35mm",
        "14 OTS / Medium / 50mm",
        "15 Telephoto Portrait / Close-up / 135mm",
    ]
    PRESET_TEXT = {
        VIEW_PRESETS[0]: "rotate camera 45 degrees right, medium shot, 35mm natural cinematic lens, eye-level angle",
        VIEW_PRESETS[1]: "rotate camera 45 degrees left, medium shot, 35mm natural cinematic lens, eye-level angle",
        VIEW_PRESETS[2]: "push camera forward, close-up shot, 50mm standard cinematic lens, eye-level angle",
        VIEW_PRESETS[3]: "pull camera backward, full body shot, 35mm natural cinematic lens, low-angle shot",
        VIEW_PRESETS[4]: "orbit around subject right, full body shot, 24mm wide cinematic lens, eye-level angle",
        VIEW_PRESETS[5]: "orbit around subject left, full body shot, 24mm wide cinematic lens, eye-level angle",
        VIEW_PRESETS[6]: "pan camera right, medium shot, 50mm standard cinematic lens, eye-level angle",
        VIEW_PRESETS[7]: "pan camera left, medium shot, 50mm standard cinematic lens, eye-level angle",
        VIEW_PRESETS[8]: "wide establishing shot, 24mm cinematic lens, high-angle view",
        VIEW_PRESETS[9]: "extreme close-up, 85mm portrait compression lens, eye-level angle",
        VIEW_PRESETS[10]: "hero low-angle full body shot, 35mm cinematic lens",
        VIEW_PRESETS[11]: "top-down medium shot, 24mm cinematic lens",
        VIEW_PRESETS[12]: "Dutch tilt medium shot, 35mm cinematic lens",
        VIEW_PRESETS[13]: "over-the-shoulder medium shot, 50mm cinematic lens",
        VIEW_PRESETS[14]: "telephoto portrait close-up, 135mm compression lens",
    }
    FAMILY_PREFIX = {
        "SD1.5": "masterpiece, best quality, detailed cinematic composition",
        "SDXL": "high quality cinematic image, coherent anatomy, detailed scene composition",
        "ANIMA": "anime cinematic illustration, expressive clean character design",
        "ERNIE": "instruction-following cinematic image edit, coherent subject and scene continuity",
        "FLUX2KLEIN": "cinematic prompt, natural language instruction, strong subject consistency",
        "ZIMAGE": "high fidelity cinematic image, clean visual structure, coherent details",
    }
    FAMILY_NEGATIVE = {
        "SD1.5": "low quality, worst quality, bad anatomy, extra fingers, missing fingers, deformed, watermark, text",
        "SDXL": "low quality, bad anatomy, malformed hands, distorted face, text, watermark, duplicate subject",
        "ANIMA": "bad anatomy, extra limbs, broken hands, low quality, messy lineart, text, watermark",
        "ERNIE": "identity drift, posture change, background replacement, bad anatomy, distorted geometry, text, watermark",
        "FLUX2KLEIN": "identity drift, anatomy error, incoherent lighting, perspective error, text, watermark",
        "ZIMAGE": "bad anatomy, identity drift, low quality, perspective error, text, watermark",
    }

    @classmethod
    def norm_family(cls, family):
        f = str(family or "SDXL").upper().replace(" ", "")
        if f in ["SD15", "SD1.5"]: return "SD1.5"
        if f in ["SDXL", "SDWL"]: return "SDXL"
        if f in ["FLUX", "FLUX2KLEIN"]: return "FLUX2KLEIN"
        if f in cls.FAMILIES: return f
        return "SDXL"

    @staticmethod
    def clean(parts):
        return [str(p).strip() for p in parts if p is not None and str(p).strip() and str(p).strip().lower() != "none"]

    @classmethod
    def join(cls, parts):
        return ", ".join(cls.clean(parts))

    @staticmethod
    def q64(x):
        return max(64, int(round(float(x) / 64.0) * 64))

    @classmethod
    def dimensions(cls, family, aspect, quality):
        base = 512 if family == "SD1.5" else 768 if quality == "low_vram_8gb" else 1024
        ratios = {"1:1": (1,1), "3:2": (3,2), "2:3": (2,3), "16:9": (16,9), "9:16": (9,16), "4:3": (4,3), "3:4": (3,4)}
        w, h = ratios.get(aspect, (1,1))
        if w >= h:
            return cls.q64(base * w / h), cls.q64(base)
        return cls.q64(base), cls.q64(base * h / w)

    @classmethod
    def profile(cls, family, quality, aspect, batch_size):
        family = cls.norm_family(family)
        width, height = cls.dimensions(family, aspect, quality)
        if family == "SD1.5":
            steps, cfg, sampler, scheduler, clip_skip = 22, 7.0, "dpmpp_2m", "karras", 1
        elif family in ["SDXL", "ANIMA"]:
            steps, cfg, sampler, scheduler, clip_skip = 28, 6.0, "dpmpp_2m_sde", "karras", 2 if family == "ANIMA" else 1
        elif family == "ERNIE":
            steps, cfg, sampler, scheduler, clip_skip = 24, 3.5, "model_specific", "model_specific", 1
        elif family == "FLUX2KLEIN":
            steps, cfg, sampler, scheduler, clip_skip = 24, 1.0, "euler", "simple", 1
        else:
            steps, cfg, sampler, scheduler, clip_skip = 24, 4.5, "euler", "normal", 1
        if quality == "low_vram_8gb":
            steps = min(steps, 20)
            batch_size = 1
        return family, cls.FAMILY_PREFIX[family], cls.FAMILY_NEGATIVE[family], steps, cfg, sampler, scheduler, width, height, 1.0, clip_skip, int(batch_size)

    @classmethod
    def preserve(cls, strictness, identity, posture, outfit, lighting, background):
        items = []
        if identity: items.append("preserve facial identity and subject identity")
        if posture: items.append("preserve original posture and body gesture")
        if outfit: items.append("preserve outfit and visible accessories")
        if lighting: items.append("preserve lighting continuity and direction")
        if background: items.append("preserve scene structure and background continuity")
        if strictness == "strict": items.append("avoid identity drift, body deformation, outfit changes, and composition collapse")
        if strictness == "very strict": items.append("strictly avoid identity drift, body deformation, background replacement, perspective errors, and unwanted style shifts")
        return items

    @classmethod
    def view_prompt(cls, family, base, view, style, strictness, identity, posture, outfit, lighting, background, suffix):
        family = cls.norm_family(family)
        return cls.join([cls.FAMILY_PREFIX[family], base, style, cls.PRESET_TEXT.get(view, view)] + cls.preserve(strictness, identity, posture, outfit, lighting, background) + [suffix])

    @classmethod
    def common_negative(cls, family, extra):
        family = cls.norm_family(family)
        return cls.join([cls.FAMILY_NEGATIVE[family], extra])

class NMDEALModelFamilyProfile(NMDEALBase):
    RETURN_TYPES = ("STRING", "STRING", "STRING", "INT", "FLOAT", "STRING", "STRING", "INT", "INT", "FLOAT", "INT", "INT", "STRING")
    RETURN_NAMES = ("model_family", "positive_prefix", "negative_prompt", "steps", "cfg", "sampler", "scheduler", "width", "height", "denoise", "clip_skip", "batch_size", "audit_summary")
    FUNCTION = "build"
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"model_family": (cls.FAMILIES,), "task_type": (cls.TASKS,), "quality_mode": (cls.QUALITY_MODES,), "aspect_ratio": (cls.ASPECTS,), "batch_size": ("INT", {"default": 1, "min": 1, "max": 25})}}
    def build(self, model_family, task_type, quality_mode, aspect_ratio, batch_size):
        fam, prefix, neg, steps, cfg, sampler, scheduler, width, height, denoise, clip_skip, bs = self.profile(model_family, quality_mode, aspect_ratio, batch_size)
        audit = f"NMDEAL profile: family={fam}; task={task_type}; quality={quality_mode}; size={width}x{height}; no checkpoint loaded."
        return fam, prefix, neg, steps, cfg, sampler, scheduler, width, height, denoise, clip_skip, bs, audit

class NMDEALCinematicPromptAdapter(NMDEALBase):
    RETURN_TYPES = ("STRING", "STRING", "STRING")
    RETURN_NAMES = ("positive_prompt", "negative_prompt", "audit_summary")
    FUNCTION = "build"
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"model_family": (cls.FAMILIES,), "base_prompt": ("STRING", {"default": "", "multiline": True}), "view_preset": (cls.VIEW_PRESETS,), "style_suffix": ("STRING", {"default": "cinematic lighting, coherent composition", "multiline": True}), "strictness": (["balanced", "strict", "very strict"],), "preserve_identity": ("BOOLEAN", {"default": True}), "preserve_posture": ("BOOLEAN", {"default": True}), "preserve_outfit": ("BOOLEAN", {"default": True}), "preserve_lighting": ("BOOLEAN", {"default": True}), "preserve_background": ("BOOLEAN", {"default": True}), "custom_suffix": ("STRING", {"default": "", "multiline": True}), "negative_extra": ("STRING", {"default": "", "multiline": True})}}
    def build(self, model_family, base_prompt, view_preset, style_suffix, strictness, preserve_identity, preserve_posture, preserve_outfit, preserve_lighting, preserve_background, custom_suffix, negative_extra):
        pos = self.view_prompt(model_family, base_prompt, view_preset, style_suffix, strictness, preserve_identity, preserve_posture, preserve_outfit, preserve_lighting, preserve_background, custom_suffix)
        neg = self.common_negative(model_family, negative_extra)
        return pos, neg, f"NMDEAL prompt adapter: family={self.norm_family(model_family)}; view={view_preset}"

class NMDEALCinematicViewBank5(NMDEALBase):
    RETURN_TYPES = ("STRING", "STRING", "STRING", "STRING", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("positive_1", "positive_2", "positive_3", "positive_4", "positive_5", "negative_common", "audit_summary")
    FUNCTION = "build"
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"model_family": (cls.FAMILIES,), "base_prompt": ("STRING", {"default": "", "multiline": True}), "style_suffix": ("STRING", {"default": "cinematic lighting, coherent composition", "multiline": True}), "view_1": (cls.VIEW_PRESETS,), "view_2": (cls.VIEW_PRESETS,), "view_3": (cls.VIEW_PRESETS,), "view_4": (cls.VIEW_PRESETS,), "view_5": (cls.VIEW_PRESETS,), "strictness": (["balanced", "strict", "very strict"],), "preserve_identity": ("BOOLEAN", {"default": True}), "preserve_posture": ("BOOLEAN", {"default": True}), "preserve_outfit": ("BOOLEAN", {"default": True}), "preserve_lighting": ("BOOLEAN", {"default": True}), "preserve_background": ("BOOLEAN", {"default": True}), "custom_suffix": ("STRING", {"default": "", "multiline": True}), "negative_extra": ("STRING", {"default": "", "multiline": True})}}
    def build(self, model_family, base_prompt, style_suffix, view_1, view_2, view_3, view_4, view_5, strictness, preserve_identity, preserve_posture, preserve_outfit, preserve_lighting, preserve_background, custom_suffix, negative_extra):
        views = [view_1, view_2, view_3, view_4, view_5]
        outs = [self.view_prompt(model_family, base_prompt, v, style_suffix, strictness, preserve_identity, preserve_posture, preserve_outfit, preserve_lighting, preserve_background, custom_suffix) for v in views]
        return (*outs, self.common_negative(model_family, negative_extra), f"NMDEAL ViewBank5: family={self.norm_family(model_family)}; views=5")

class NMDEALCineMatrix5x5(NMDEALBase):
    RETURN_TYPES = tuple(["STRING"] * 27)
    RETURN_NAMES = tuple([f"i{i}_v{j}" for i in range(1,6) for j in range(1,6)] + ["negative_common", "audit_summary"])
    FUNCTION = "build"
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"model_family": (cls.FAMILIES,), "prompt_1": ("STRING", {"default": "image 1 subject", "multiline": True}), "prompt_2": ("STRING", {"default": "image 2 subject", "multiline": True}), "prompt_3": ("STRING", {"default": "image 3 subject", "multiline": True}), "prompt_4": ("STRING", {"default": "image 4 subject", "multiline": True}), "prompt_5": ("STRING", {"default": "image 5 subject", "multiline": True}), "style_suffix": ("STRING", {"default": "cinematic lighting, coherent composition", "multiline": True}), "view_1": (cls.VIEW_PRESETS,), "view_2": (cls.VIEW_PRESETS,), "view_3": (cls.VIEW_PRESETS,), "view_4": (cls.VIEW_PRESETS,), "view_5": (cls.VIEW_PRESETS,), "strictness": (["balanced", "strict", "very strict"],), "preserve_identity": ("BOOLEAN", {"default": True}), "preserve_posture": ("BOOLEAN", {"default": True}), "preserve_outfit": ("BOOLEAN", {"default": True}), "preserve_lighting": ("BOOLEAN", {"default": True}), "preserve_background": ("BOOLEAN", {"default": True}), "custom_suffix": ("STRING", {"default": "", "multiline": True}), "negative_extra": ("STRING", {"default": "", "multiline": True})}}
    def build(self, model_family, prompt_1, prompt_2, prompt_3, prompt_4, prompt_5, style_suffix, view_1, view_2, view_3, view_4, view_5, strictness, preserve_identity, preserve_posture, preserve_outfit, preserve_lighting, preserve_background, custom_suffix, negative_extra):
        prompts = [prompt_1, prompt_2, prompt_3, prompt_4, prompt_5]
        views = [view_1, view_2, view_3, view_4, view_5]
        outs = []
        for p in prompts:
            for v in views:
                outs.append(self.view_prompt(model_family, p, v, style_suffix, strictness, preserve_identity, preserve_posture, preserve_outfit, preserve_lighting, preserve_background, custom_suffix))
        return (*outs, self.common_negative(model_family, negative_extra), f"NMDEAL CineMatrix5x5: family={self.norm_family(model_family)}; prompts=25")

class NMDEALFiveImagePassthrough(NMDEALBase):
    RETURN_TYPES = ("IMAGE", "IMAGE", "IMAGE", "IMAGE", "IMAGE", "STRING")
    RETURN_NAMES = ("image_1", "image_2", "image_3", "image_4", "image_5", "audit_summary")
    FUNCTION = "pass_images"
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"image_1": ("IMAGE",), "image_2": ("IMAGE",), "image_3": ("IMAGE",), "image_4": ("IMAGE",), "image_5": ("IMAGE",), "label_1": ("STRING", {"default": "image1"}), "label_2": ("STRING", {"default": "image2"}), "label_3": ("STRING", {"default": "image3"}), "label_4": ("STRING", {"default": "image4"}), "label_5": ("STRING", {"default": "image5"})}}
    def pass_images(self, image_1, image_2, image_3, image_4, image_5, label_1, label_2, label_3, label_4, label_5):
        return image_1, image_2, image_3, image_4, image_5, f"NMDEAL passthrough: {label_1}, {label_2}, {label_3}, {label_4}, {label_5}"

class NMDEALFilenameMatrix5x5(NMDEALBase):
    RETURN_TYPES = tuple(["STRING"] * 26)
    RETURN_NAMES = tuple([f"prefix_i{i}_v{j}" for i in range(1,6) for j in range(1,6)] + ["audit_summary"])
    FUNCTION = "build"
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"base_prefix": ("STRING", {"default": "NMDEAL_Cine"}), "separator": ("STRING", {"default": "_"}), "include_family": ("BOOLEAN", {"default": True}), "model_family": (cls.FAMILIES,)}}
    def build(self, base_prefix, separator, include_family, model_family):
        fam = self.norm_family(model_family)
        root = self.join([base_prefix, fam]) if include_family else str(base_prefix)
        root = root.replace(", ", separator).replace(" ", separator)
        outs = [f"{root}{separator}I{i}{separator}V{j}" for i in range(1,6) for j in range(1,6)]
        return (*outs, f"NMDEAL filename matrix: 25 prefixes; family={fam}")

NODE_CLASS_MAPPINGS = {
    "NMDEALModelFamilyProfile": NMDEALModelFamilyProfile,
    "NMDEALCinematicPromptAdapter": NMDEALCinematicPromptAdapter,
    "NMDEALCinematicViewBank5": NMDEALCinematicViewBank5,
    "NMDEALCineMatrix5x5": NMDEALCineMatrix5x5,
    "NMDEALFiveImagePassthrough": NMDEALFiveImagePassthrough,
    "NMDEALFilenameMatrix5x5": NMDEALFilenameMatrix5x5,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "NMDEALModelFamilyProfile": "NMDEAL Model Family Profile",
    "NMDEALCinematicPromptAdapter": "NMDEAL Cinematic Prompt Adapter",
    "NMDEALCinematicViewBank5": "NMDEAL Cinematic ViewBank5",
    "NMDEALCineMatrix5x5": "NMDEAL CineMatrix5x5",
    "NMDEALFiveImagePassthrough": "NMDEAL Five Image Passthrough",
    "NMDEALFilenameMatrix5x5": "NMDEAL Filename Matrix5x5",
}
