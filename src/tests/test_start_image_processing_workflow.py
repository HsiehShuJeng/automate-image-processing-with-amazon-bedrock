from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest import TestCase, mock

TESTS_DIR = Path(__file__).resolve().parent
PACKAGE_ROOT = TESTS_DIR.parent
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.append(str(PACKAGE_ROOT))

from tests.utils import load_module_from_path, ROOT_DIR  # noqa: E402

MODULE_PATH = ROOT_DIR / 'start-image-processing-workflow' / 'app.py'


def _sample_dynamodb_item() -> dict:
    return {
        'NewImage': {
            'Id': {'S': 'workflow-123'},
            'ImageS3Prefix': {'S': 'user-uploads/session-1'},
            'Prompt': {'S': 'Create a futuristic city skyline at dusk'},
            'NegativePrompt': {'S': 'No haze'},
            'Mode': {'S': 'variation'},
            'Images': {
                'L': [
                    {
                        'M': {
                            'ImageName': {'S': 'sample-1.jpg'},
                            'Labels': {'S': 'city,building'}
                        }
                    }
                ]
            }
        }
    }


class StartImageProcessingWorkflowTests(TestCase):
    def setUp(self) -> None:
        os.environ['STATE_MACHINE_IMAGE_PROCESSING_ARN'] = 'arn:aws:states:region:123456789012:stateMachine:ImageProcessing'
        os.environ['INPUT_BUCKET'] = 'image-processing-input'
        os.environ['IMAGE_PREFIX'] = 'source/'
        os.environ['GENERATED_IMAGE_PREFIX'] = 'generated/'
        os.environ['STATUS_REPORT_PREFIX'] = 'status/'
        self.module = load_module_from_path('start_image_processing_workflow', MODULE_PATH)

    def test_build_workflow_input_constructs_expected_payload(self) -> None:
        dynamodb_item = _sample_dynamodb_item()
        record = self.module.build_workflow_input(dynamodb_item)

        self.assertEqual(record['Id'], 'workflow-123')
        self.assertEqual(record['S3Bucket'], 'image-processing-input')
        self.assertEqual(record['InputS3Prefix'], 'source/user-uploads/session-1')
        self.assertEqual(record['OutputS3Prefix'], 'generated/user-uploads/session-1')
        self.assertEqual(record['StatusS3Prefix'], 'status/user-uploads/session-1')
        self.assertEqual(record['Mode'], 'variation')
        self.assertEqual(len(record['Images']), 1)
        self.assertEqual(record['Images'][0]['ImageName'], 'sample-1.jpg')

    def test_lambda_handler_invokes_step_functions(self) -> None:
        dynamodb_item = _sample_dynamodb_item()
        event = {'Records': [{'dynamodb': dynamodb_item}]}

        execution_response = {'executionArn': 'arn:aws:states:region:123:execution'}
        with mock.patch.object(self.module, 'start_step_function_execution', return_value=execution_response) as start_mock:
            response = self.module.lambda_handler(event, None)

        self.assertEqual(response['statusCode'], 200)
        self.assertEqual(response['executionArn'], execution_response['executionArn'])
        start_mock.assert_called_once()
        args, _ = start_mock.call_args
        self.assertEqual(args[0]['Id'], 'workflow-123')

    def test_start_step_function_execution_requires_state_machine_arn(self) -> None:
        self.module.STATE_MACHINE_IMAGE_PROCESSING_ARN = None
        with self.assertRaises(ValueError):
            self.module.start_step_function_execution({'Id': 'workflow-123'})

    def test_start_step_function_execution_invokes_client(self) -> None:
        mock_client = mock.Mock()
        mock_client.start_execution.return_value = {'executionArn': 'arn:aws:states:region:123:execution'}
        self.module.step_function = mock_client

        record = {'Id': 'workflow-123'}
        response = self.module.start_step_function_execution(record)

        mock_client.start_execution.assert_called_once()
        self.assertEqual(response['executionArn'], 'arn:aws:states:region:123:execution')
