import torch
from torch import nn
import torch.nn.functional as F


def fit_temperature(logits, targets):
    logits, targets = logits.detach().float().cpu(), targets.detach().float().cpu()
    if len(logits) < 2 or targets.unique().numel() != 2:
        raise ValueError("Calibration requires held-out real samples of both classes")
    log_t = nn.Parameter(torch.zeros(()))
    optimizer = torch.optim.LBFGS([log_t], lr=.1, max_iter=100, line_search_fn="strong_wolfe")

    def closure():
        optimizer.zero_grad()
        loss = F.binary_cross_entropy_with_logits(logits / log_t.clamp(-5, 5).exp(), targets)
        loss.backward()
        return loss

    optimizer.step(closure)
    return float(log_t.detach().clamp(-5, 5).exp())


def calibrated_probabilities(output, calibration):
    calibration = calibration or {}
    image_t = calibration.get("image_temperature", 1.)
    fusion_t = calibration.get("fusion_temperature", 1.)
    image_p = torch.sigmoid(output["image_logit"].float() / image_t)
    final_p = torch.where(output["metadata_available"],
                          torch.sigmoid(output["final_logit"].float() / fusion_t), image_p)
    calibrated = torch.where(output["metadata_available"],
                              torch.full_like(final_p, "fusion_temperature" in calibration, dtype=torch.bool),
                              torch.full_like(final_p, "image_temperature" in calibration, dtype=torch.bool))
    return image_p, final_p, calibrated
