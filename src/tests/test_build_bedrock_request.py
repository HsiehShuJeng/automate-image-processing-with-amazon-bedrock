from __future__ import annotations

import base64
import os
import sys
from pathlib import Path
from unittest import TestCase, mock

TESTS_DIR = Path(__file__).resolve().parent
PACKAGE_ROOT = TESTS_DIR.parent
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.append(str(PACKAGE_ROOT))

from tests.utils import load_module_from_path, ROOT_DIR  # noqa: E402

MODULE_PATH = ROOT_DIR / 'build-bedrock-request' / 'app.py'


class BuildBedrockRequestTests(TestCase):
    def setUp(self) -> None:
        self.module = load_module_from_path('build_bedrock_request', MODULE_PATH)

    def test_extract_request_data_parses_event(self) -> None:
        event = {
            'S3Bucket': 'input-bucket',
            'InputS3Prefix': 'uploads',
            'Prompt': 'Generate an image of mountains',
            'NegativePrompt': 'No fog',
            'Mode': 'variation',
            'Image': {
                'ImageName': 'mountain.png',
                'Labels': 'mountain,landscape'
            }
        }

        result = self.module.extract_request_data(event)

        self.assertEqual(result['s3_bucket'], 'input-bucket')
        self.assertEqual(result['s3_output_key'], 'uploads/mountain.json')
        self.assertEqual(result['image_labels'], 'mountain,landscape')

    def test_extract_request_data_missing_field_raises(self) -> None:
        with self.assertRaises(ValueError):
            self.module.extract_request_data({'Prompt': 'Missing fields'})

    def test_build_bedrock_request_payload_handles_variation_mode(self) -> None:
        payload = self.module.build_bedrock_request_payload(
            'image-data', 'prompt', 'negative', 'variation'
        )
        self.assertEqual(payload['taskType'], 'IMAGE_VARIATION')
        self.assertIn('imageVariationParams', payload)
        self.assertNotIn('textToImageParams', payload)

    def test_build_bedrock_request_payload_handles_text_mode(self) -> None:
        payload = self.module.build_bedrock_request_payload(
            'image-data', 'prompt', 'negative', 'text-to-image'
        )
        self.assertEqual(payload['taskType'], 'TEXT_IMAGE')
        self.assertIn('textToImageParams', payload)

    @mock.patch('build_bedrock_request.s3_client')
    def test_download_and_encode_image_reads_file(self, mock_s3_client: mock.Mock) -> None:
        def _write_tmp_file(_bucket: str, _key: str, download_path: str) -> None:
            with open(download_path, 'wb') as tmp_file:
                tmp_file.write(b'example-bytes')

        mock_s3_client.download_file.side_effect = _write_tmp_file

        encoded = self.module.download_and_encode_image('bucket', 'prefix', 'image.jpg')

        expected = base64.b64encode(b'example-bytes').decode('utf-8')
        self.assertEqual(encoded, expected)
        self.assertFalse(os.path.exists('/tmp/image.jpg'))

    @mock.patch('build_bedrock_request.s3_client')
    def test_store_request_payload_writes_to_s3(self, mock_s3_client: mock.Mock) -> None:
        payload = {'test': 'value'}
        self.module.store_request_payload('bucket', 'key.json', payload)
        mock_s3_client.put_object.assert_called_once()
        args, kwargs = mock_s3_client.put_object.call_args
        self.assertEqual(kwargs['Bucket'], 'bucket')
        self.assertEqual(kwargs['Key'], 'key.json')

    def test_lambda_handler_returns_success_response(self) -> None:
        event = {
            'S3Bucket': 'input-bucket',
            'InputS3Prefix': 'uploads',
            'Prompt': 'Generate an image of mountains',
            'NegativePrompt': 'No fog',
            'Mode': 'variation',
            'Image': {
                'ImageName': 'mountain.png',
                'Labels': 'mountain,landscape'
            }
        }

        with mock.patch.object(self.module, 'download_and_encode_image', return_value='encoded-image') as download_mock, \
             mock.patch.object(self.module, 'store_request_payload') as store_mock:
            response = self.module.lambda_handler(event, None)

        download_mock.assert_called_once()
        store_mock.assert_called_once()
        self.assertEqual(response['statusCode'], 200)
        self.assertEqual(response['S3Bucket'], 'input-bucket')
        self.assertEqual(response['S3Key'], 'uploads/mountain.json')
        self.assertIn('BedrockRequest', response)
