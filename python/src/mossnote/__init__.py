"""Mossnote: a private, spoiler-free journal for the games you play."""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("mossnote")  # PEP 440, such as 0.1.0b1
except PackageNotFoundError:
    __version__ = "unknown"

__all__ = ["__version__"]
