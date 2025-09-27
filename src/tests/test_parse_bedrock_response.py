from __future__ import annotations

import base64
import sys
from pathlib import Path
from unittest import TestCase, mock

TESTS_DIR = Path(__file__).resolve().parent
PACKAGE_ROOT = TESTS_DIR.parent
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.append(str(PACKAGE_ROOT))

from tests.utils import load_module_from_path, ROOT_DIR  # noqa: E402

MODULE_PATH = ROOT_DIR / 'parse-bedrock-response' / 'app.py'


class ParseBedrockResponseTests(TestCase):
    def setUp(self) -> None:
        self.module = load_module_from_path('parse_bedrock_response', MODULE_PATH)

    def test_extract_response_data_parses_event(self) -> None:
        event = {
            'S3Bucket': 'output-bucket',
            'OutputS3Prefix': 'results',
            'Image': {'ImageName': 'sample.png'}
        }
        result = self.module.extract_response_data(event)
        self.assertEqual(result['s3_bucket'], 'output-bucket')
        self.assertEqual(result['s3_output_key'], 'results/sample.json')

    def test_extract_response_data_missing_field_raises(self) -> None:
        with self.assertRaises(ValueError):
            self.module.extract_response_data({'S3Bucket': 'bucket'})

    @mock.patch('parse_bedrock_response.s3_client')
    def test_download_bedrock_response_reads_object(self, mock_s3_client: mock.Mock) -> None:
        mock_body = mock.Mock()
        mock_body.read.return_value = b'{"images": []}'
        mock_s3_client.get_object.return_value = {'Body': mock_body}

        result = self.module.download_bedrock_response('bucket', 'key.json')

        self.assertIn('images', result)
        mock_s3_client.get_object.assert_called_once_with(Bucket='bucket', Key='key.json')

    def test_process_generated_images_uploads_results(self) -> None:
        image_bytes = base64.b64encode(b'image-one').decode('utf-8')
        bedrock_response = {'images': [image_bytes]}

        with mock.patch.object(self.module, 'process_single_image', return_value=b'processed-bytes') as process_mock, \
             mock.patch.object(self.module, 'upload_image_to_s3') as upload_mock:
            results = self.module.process_generated_images(bedrock_response, 'bucket', 'output', 'base')

        process_mock.assert_called_once()
        upload_mock.assert_called_once()
        self.assertEqual(len(results), 1)
        self.assertTrue(results[0]['filename'].endswith('.png'))

    def test_process_generated_images_handles_artifacts_fallback(self) -> None:
        artifact_bytes = base64.b64encode(b'artifact-image').decode('utf-8')
        bedrock_response = {'artifacts': [{'base64': artifact_bytes}]}

        with mock.patch.object(self.module, 'process_single_image', return_value=b'bytes') as process_mock, \
             mock.patch.object(self.module, 'upload_image_to_s3'):
            results = self.module.process_generated_images(bedrock_response, 'bucket', 'output', 'base')

        process_mock.assert_called_once()
        self.assertEqual(len(results), 1)

    @mock.patch('parse_bedrock_response.Image')
    def test_process_single_image_converts_and_serialises(self, mock_image_module: mock.Mock) -> None:
        mock_image = mock.Mock()
        mock_image.mode = 'RGBA'
        mock_image.convert.return_value = mock_image
        mock_buffer = mock.Mock()
        mock_buffer.getvalue.return_value = b'png-bytes'

        mock_image_module.open.return_value = mock_image

        with mock.patch('parse_bedrock_response.io.BytesIO', return_value=mock_buffer) as mock_buffer_cls:
            result = self.module.process_single_image(b'raw-bytes')

        mock_image_module.open.assert_called_once()
        mock_image.convert.assert_called_once_with('RGB')
        mock_buffer_cls.assert_called()
        mock_image.save.assert_called_once()
        self.assertEqual(result, b'png-bytes')

    @mock.patch('parse_bedrock_response.s3_client')
    def test_upload_image_to_s3_puts_object(self, mock_s3_client: mock.Mock) -> None:
        self.module.upload_image_to_s3('bucket', 'key.png', b'data')
        mock_s3_client.put_object.assert_called_once_with(
            Bucket='bucket', Key='key.png', Body=b'data', ContentType='image/png'
        )

    def test_lambda_handler_returns_processed_images(self) -> None:
        event = {
            'S3Bucket': 'bucket',
            'OutputS3Prefix': 'generated',
            'Image': {'ImageName': 'sample.png'}
        }

        with mock.patch.object(self.module, 'download_bedrock_response', return_value={'images': []}) as download_mock, \
             mock.patch.object(self.module, 'process_generated_images', return_value=[{'filename': 'file.png'}]) as process_mock:
            response = self.module.lambda_handler(event, None)

        download_mock.assert_called_once()
        process_mock.assert_called_once()
        self.assertEqual(response['statusCode'], 200)
        self.assertEqual(response['S3Bucket'], 'bucket')
        self.assertEqual(response['OutputPrefix'], 'generated')
        self.assertEqual(len(response['ProcessedImages']), 1)
