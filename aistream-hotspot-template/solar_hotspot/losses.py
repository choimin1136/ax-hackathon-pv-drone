import torch
import torch.nn.functional as F


def segmentation_loss(logits, target, positive_weight=10.):
    """Full-resolution CE, positive-view Dice; empty normal masks still get CE."""
    valid = target != 255
    ce = F.cross_entropy(logits.float(), target, weight=logits.new_tensor([1., positive_weight]).float(),
                         ignore_index=255, reduction="none")
    ce = (ce * valid).sum((1, 2)) / valid.sum((1, 2)).clamp_min(1)
    p = logits.float().softmax(1)[:, 1] * valid
    y = (target == 1).float()
    present = y.sum((1, 2)) > 0
    dice = 1 - (2 * (p * y).sum((1, 2)) + 1e-6) / (p.sum((1, 2)) + y.sum((1, 2)) + 1e-6)
    return (ce + dice * present).mean()


def stage_loss(output, target, stage):
    image = F.binary_cross_entropy_with_logits(output["image_logit"].float(), target.float())
    final = F.binary_cross_entropy_with_logits(output["final_logit"].float(), target.float())
    residual = output["applied_delta"].float().square().mean()
    seg = output["segmentation_loss"]
    if stage == "seg":
        total = seg
    elif stage == "image":
        total = image
    elif stage == "fusion":
        total = final + .01 * residual
    elif stage == "joint":
        total = seg + .5 * image + final + .01 * residual
    else:
        raise ValueError(f"Unknown training stage {stage}")
    return {"loss": total, "seg": seg, "image": image, "final": final, "residual": residual}
