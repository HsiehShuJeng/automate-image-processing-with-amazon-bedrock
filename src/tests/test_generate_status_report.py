from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import TestCase, mock

TESTS_DIR = Path(__file__).resolve().parent
PACKAGE_ROOT = TESTS_DIR.parent
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.append(str(PACKAGE_ROOT))

from tests.utils import load_module_from_path, ROOT_DIR  # noqa: E402

MODULE_PATH = ROOT_DIR / 'generate-status-report' / 'app.py'


class GenerateStatusReportTests(TestCase):
    def setUp(self) -> None:
        os.environ['STATUS_TABLE'] = 'StatusTable'
        os.environ['STATUS_REPORT_URL_EXPIRATION'] = '3600'
        self.module = load_module_from_path('generate_status_report', MODULE_PATH)

    def test_extract_processing_data_requires_fields(self) -> None:
        with self.assertRaises(ValueError):
            self.module.extract_processing_data({'S3Bucket': 'bucket'})

    def test_generate_status_report_contains_summary(self) -> None:
        processing_data = {
            's3_bucket': 'bucket',
            'status_s3_prefix': 'status',
            'workflow_id': 'workflow-1',
            'prompt': 'Prompt',
            'negative_prompt': 'Negative',
            'mode': 'variation',
            'input_images': [{'ImageName': 'one.jpg'}],
            'processed_images': [{'filename': 'processed.png'}],
            'started_at': datetime.now(timezone.utc).isoformat()
        }
        report = self.module.generate_status_report(processing_data)
        self.assertEqual(report['workflow_id'], 'workflow-1')
        self.assertEqual(report['processing_summary']['input_images_count'], 1)
        self.assertEqual(report['processing_summary']['processed_images_count'], 1)

    def test_calculate_processing_duration_when_started(self) -> None:
        started = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
        processing_data = {'started_at': started}
        duration = self.module.calculate_processing_duration(processing_data)
        self.assertGreater(duration, 0)

    @mock.patch('generate_status_report.s3_client')
    def test_store_status_report_uploads_json(self, mock_s3_client: mock.Mock) -> None:
        key = self.module.store_status_report('bucket', 'prefix', 'workflow-1', {'status': 'ok'})
        self.assertTrue(key.startswith('prefix/status_report_workflow-1_'))
        mock_s3_client.put_object.assert_called_once()

    @mock.patch('generate_status_report.s3_client')
    def test_generate_presigned_url_uses_configured_expiration(self, mock_s3_client: mock.Mock) -> None:
        mock_s3_client.generate_presigned_url.return_value = 'https://example.com'
        url = self.module.generate_presigned_url('bucket', 'key.json')
        mock_s3_client.generate_presigned_url.assert_called_once()
        self.assertEqual(url, 'https://example.com')

    def test_update_status_table_skips_when_env_missing(self) -> None:
        self.module.STATUS_TABLE = None
        with mock.patch.object(self.module, 'dynamodb') as mock_dynamodb:
            self.module.update_status_table('workflow-1', {'status': 'COMPLETED'})
        mock_dynamodb.Table.assert_not_called()

    def test_update_status_table_updates_item(self) -> None:
        mock_table = mock.Mock()
        mock_dynamodb = mock.Mock()
        mock_dynamodb.Table.return_value = mock_table
        self.module.dynamodb = mock_dynamodb

        self.module.update_status_table('workflow-1', {'status': 'COMPLETED'})
        mock_table.update_item.assert_called_once()

    def test_lambda_handler_executes_workflow(self) -> None:
        event = {'detail': 'value'}
        processing_data = {
            's3_bucket': 'bucket',
            'status_s3_prefix': 'status',
            'workflow_id': 'workflow-1',
            'processed_images': []
        }

        with mock.patch.object(self.module, 'extract_processing_data', return_value=processing_data) as extract_mock, \
             mock.patch.object(self.module, 'generate_status_report', return_value={'status': 'ok'}) as report_mock, \
             mock.patch.object(self.module, 'store_status_report', return_value='status/key.json') as store_mock, \
             mock.patch.object(self.module, 'generate_presigned_url', return_value='https://example.com') as url_mock, \
             mock.patch.object(self.module, 'update_status_table') as update_mock:
            response = self.module.lambda_handler(event, None)

        extract_mock.assert_called_once()
        report_mock.assert_called_once()
        store_mock.assert_called_once()
        url_mock.assert_called_once()
        update_mock.assert_called_once()
        self.assertEqual(response['statusCode'], 200)
        self.assertEqual(response['ReportS3Key'], 'status/key.json')
        self.assertEqual(response['WorkflowId'], 'workflow-1')
