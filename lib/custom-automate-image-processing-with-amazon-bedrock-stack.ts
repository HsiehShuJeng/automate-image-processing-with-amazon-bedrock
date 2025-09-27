import { Construct } from 'constructs';
import { ImageProcessingStage, ImageProcessingStageProps } from './image-processing-stack';

/**
 * Backwards-compatible class name that represents the composed image processing stacks.
 *
 * The class now extends {@link ImageProcessingStage} to orchestrate all infrastructure
 * components defined across individual stacks.
 */
export class CustomAutomateImageProcessingWithAmazonBedrockStack extends ImageProcessingStage {
  constructor(scope: Construct, id: string, props?: ImageProcessingStageProps) {
    super(scope, id, props);
  }
}
