"""Build-time option inspection requires only click."""
import click


@click.command()
@click.option('--checkpoint', default='hotspot.pt', show_default=True,
              help='Checkpoint path relative to the model input mount.')
@click.option('--image-threshold', type=click.FloatRange(0, 1), default=0.5)
@click.option('--seg-threshold', type=click.FloatRange(0, 1), default=0.5)
def main(checkpoint, image_threshold, seg_threshold):
    from src.serving_runtime import run_serving
    run_serving(checkpoint=checkpoint, device='cuda',
                image_threshold=image_threshold, seg_threshold=seg_threshold)


if __name__ == '__main__':
    main()
