"""Shared utilities for compute layer unit tests."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType
from typing import Optional


def load_module_from_path(module_name: str, file_path: Path, package: Optional[str] = None) -> ModuleType:
    """Dynamically load a Python module from a file path.

    Args:
        module_name: Unique name to register the module under in ``sys.modules``.
        file_path: Absolute path to the module source file.
        package: Optional package name to associate with the module.

    Returns:
        Loaded module instance.
    """
    if module_name in sys.modules:
        del sys.modules[module_name]

    spec = importlib.util.spec_from_file_location(module_name, file_path, submodule_search_locations=None)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot import module {module_name} from {file_path}")

    module = importlib.util.module_from_spec(spec)
    if package:
        module.__package__ = package
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


TESTS_DIR = Path(__file__).resolve().parent
ROOT_DIR = TESTS_DIR.parent
