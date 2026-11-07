from dataclasses import asdict, dataclass


@dataclass
class ModelConfig:
    backbone: str = "b1"  # b1 for real training; tiny for offline tests
    view_size: int = 640
    tile_size: int = 320
    tiles: bool = True
    decoder_dim: int = 256
    image_dim: int = 128
    metadata_dim: int = 16
    metadata_embedding_dim: int = 32
    delta_max: float = 2.0
    view_chunk_size: int = 1

    def __post_init__(self):
        if self.backbone not in {"b0", "b1", "tiny"}:
            raise ValueError("backbone must be b0, b1 or tiny")
        if self.view_size < 32 or self.view_size % 32:
            raise ValueError("view_size must be a positive multiple of 32")
        if self.tile_size <= 0 or self.view_chunk_size <= 0:
            raise ValueError("tile_size and view_chunk_size must be positive")
        if self.metadata_dim != 16:
            raise ValueError("metadata schema v1 contains exactly 16 values")

    def to_dict(self):
        return asdict(self)
