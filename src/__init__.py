"""CHEERS model and inference exports, loaded lazily by runtime."""

__all__ = [
    "RGCNDDIModel",
    "DDIPredictor",
]


def __getattr__(name):
    if name == "RGCNDDIModel":
        from .rgcn_model import RGCNDDIModel

        return RGCNDDIModel

    if name == "DDIPredictor":
        from .inference import DDIPredictor

        return DDIPredictor

    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
