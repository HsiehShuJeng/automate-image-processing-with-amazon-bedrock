"""Shared observability utilities for image processing Lambdas."""

from aws_lambda_powertools import Logger, Tracer
from aws_lambda_powertools.logging import correlation_paths
from aws_lambda_powertools.metrics import Metrics

logger = Logger()
tracer = Tracer()
metrics = Metrics()

__all__ = [
    'logger',
    'tracer',
    'metrics',
    'correlation_paths',
]
