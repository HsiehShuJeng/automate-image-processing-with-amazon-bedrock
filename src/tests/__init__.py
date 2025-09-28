"""Test utilities and stubs for compute layer unit tests.

This module provides lightweight stubs for optional dependencies used in the
Lambda source code so unit tests can run without requiring the actual
`aws_lambda_powertools` or `boto3` packages at test time.
"""

from __future__ import annotations

import sys
import types
from typing import Any, Callable, Optional
from unittest.mock import MagicMock


def _noop_decorator(func: Optional[Callable[..., Any]] = None, *args: Any, **kwargs: Any) -> Callable[..., Any]:
    """Return a decorator that preserves the wrapped function."""
    if func is not None and callable(func):
        return func

    def _wrapper(inner: Callable[..., Any]) -> Callable[..., Any]:
        return inner

    return _wrapper


class _Logger:
    def __init__(self, *args: Any, **kwargs: Any) -> None:  # noqa: D401
        pass

    def info(self, *args: Any, **kwargs: Any) -> None:
        pass

    def error(self, *args: Any, **kwargs: Any) -> None:
        pass

    def warning(self, *args: Any, **kwargs: Any) -> None:
        pass

    def append_keys(self, *args: Any, **kwargs: Any) -> None:
        pass

    def set_correlation_id(self, *args: Any, **kwargs: Any) -> None:
        pass

    def inject_lambda_context(self, *args: Any, **kwargs: Any) -> Callable[..., Any]:
        return _noop_decorator


class _Tracer:
    def __init__(self, *args: Any, **kwargs: Any) -> None:  # noqa: D401
        pass

    def capture_lambda_handler(self, func: Optional[Callable[..., Any]] = None, *args: Any, **kwargs: Any) -> Callable[..., Any]:
        return _noop_decorator(func, *args, **kwargs)

    def capture_method(self, func: Optional[Callable[..., Any]] = None, *args: Any, **kwargs: Any) -> Callable[..., Any]:
        return _noop_decorator(func, *args, **kwargs)

    def put_annotation(self, *args: Any, **kwargs: Any) -> None:
        pass

    def put_metadata(self, *args: Any, **kwargs: Any) -> None:
        pass


class _Metrics:
    def __init__(self, *args: Any, **kwargs: Any) -> None:  # noqa: D401
        pass

    def add_metric(self, *args: Any, **kwargs: Any) -> None:
        pass

    def set_default_dimensions(self, *args: Any, **kwargs: Any) -> None:
        pass

    def log_metrics(self, func: Optional[Callable[..., Any]] = None, *args: Any, **kwargs: Any) -> Callable[..., Any]:
        return _noop_decorator(func, *args, **kwargs)


class _MetricUnit:
    Count = "Count"


def _ensure_powertools_stubs() -> None:
    """Register lightweight stubs for aws_lambda_powertools if it is absent."""
    if 'aws_lambda_powertools' in sys.modules:
        return

    powertools_module = types.ModuleType('aws_lambda_powertools')
    powertools_module.Logger = _Logger  # type: ignore[attr-defined]
    powertools_module.Tracer = _Tracer  # type: ignore[attr-defined]
    powertools_module.Metrics = _Metrics  # type: ignore[attr-defined]

    metrics_module = types.ModuleType('aws_lambda_powertools.metrics')
    metrics_module.Metrics = _Metrics  # type: ignore[attr-defined]
    metrics_module.MetricUnit = _MetricUnit  # type: ignore[attr-defined]

    logging_module = types.ModuleType('aws_lambda_powertools.logging')
    correlation_paths = types.SimpleNamespace(
        API_GATEWAY_REST='API_GATEWAY_REST',
        DYNAMODB_STREAM='DYNAMODB_STREAM'
    )
    logging_module.correlation_paths = correlation_paths  # type: ignore[attr-defined]

    powertools_module.metrics = metrics_module  # type: ignore[attr-defined]
    powertools_module.logging = logging_module  # type: ignore[attr-defined]

    sys.modules['aws_lambda_powertools'] = powertools_module
    sys.modules['aws_lambda_powertools.metrics'] = metrics_module
    sys.modules['aws_lambda_powertools.logging'] = logging_module


def _ensure_common_layer_stub() -> None:
    """Register stubs for the common utilities layer module."""
    if 'image_processing_common.observability' in sys.modules:
        return

    common_root = types.ModuleType('image_processing_common')
    observability_module = types.ModuleType('image_processing_common.observability')
    observability_module.logger = _Logger()  # type: ignore[attr-defined]
    observability_module.tracer = _Tracer()  # type: ignore[attr-defined]
    observability_module.metrics = _Metrics()  # type: ignore[attr-defined]
    observability_module.correlation_paths = types.SimpleNamespace(
        API_GATEWAY_REST='API_GATEWAY_REST',
        DYNAMODB_STREAM='DYNAMODB_STREAM'
    )

    sys.modules['image_processing_common'] = common_root
    sys.modules['image_processing_common.observability'] = observability_module


def _ensure_boto3_stub() -> None:
    """Register a very small stub for boto3 if the real library is unavailable."""
    if 'boto3' in sys.modules:
        return

    boto3_module = types.ModuleType('boto3')

    def _client(service_name: str, *args: Any, **kwargs: Any) -> MagicMock:
        return MagicMock(name=f"{service_name}_client")

    def _resource(service_name: str, *args: Any, **kwargs: Any) -> MagicMock:
        return MagicMock(name=f"{service_name}_resource")

    boto3_module.client = _client  # type: ignore[attr-defined]
    boto3_module.resource = _resource  # type: ignore[attr-defined]

    sys.modules['boto3'] = boto3_module


_ensure_powertools_stubs()
_ensure_common_layer_stub()
_ensure_boto3_stub()
