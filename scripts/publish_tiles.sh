#!/bin/bash
# ===============================================================
# publish_tiles.sh: upload public/data to the site bucket
# ===============================================================
# The tiles are gitignored and one of them is larger than GitHub
# accepts, so the deploy workflow cannot carry them, and it leaves
# data/ in the bucket alone. This uploads, from this machine, into
# data/ in the same bucket the viewer is served from:
#   - every public/data/*.pmtiles (the road tiles), and
#   - public/data/services.geojson (the Detours service points),
# then tells CloudFront to drop its cached copies, if anything changed.
#
# It runs by itself before every push to master, through the pre-push
# hook in .githooks/ (turned on by `npm install`), so the tiles are on
# the site before the app that reads them. It can also be run by hand:
#
#   bash scripts/publish_tiles.sh        (or: npm run tiles:publish)
#
# Uses whatever AWS credentials the aws CLI picks up (the default
# profile, or AWS_PROFILE). The bucket and distribution are read
# from the CloudFormation stack, so nothing is hard-coded here.
# Set STACK to point at a differently named stack.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO/public/data"
STACK="${STACK:-road-network-connectivity}"
REGION="us-east-1"

if ! ls "$SRC"/*.pmtiles >/dev/null 2>&1; then
    echo "No .pmtiles in $SRC. Run 'npm run tiles' first."
    exit 1
fi

output() {
    aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" \
        --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

BUCKET="$(output BucketName)"
DISTRIBUTION="$(output DistributionId)"

if [ -z "$BUCKET" ] || [ -z "$DISTRIBUTION" ]; then
    echo "Could not read BucketName and DistributionId from stack '$STACK'."
    exit 1
fi

echo "Uploading changed tiles to s3://$BUCKET/data/"

# No --delete: a file that is absent locally stays in the bucket. sync only
# sends files whose size or date differ from the bucket's copy, and prints a
# line for each one it sends, which is how a change is noticed below.
changed="$(aws s3 sync "$SRC" "s3://$BUCKET/data" \
    --exclude "*" --include "*.pmtiles" \
    --content-type "application/octet-stream" \
    --cache-control "no-cache")"
if [ -f "$SRC/services.geojson" ]; then
    changed="$changed$(aws s3 sync "$SRC" "s3://$BUCKET/data" \
        --exclude "*" --include "services.geojson" \
        --content-type "application/geo+json" \
        --cache-control "no-cache")"
fi

if [ -z "$changed" ]; then
    echo "Nothing changed; the bucket already has these files."
    exit 0
fi
echo "$changed"

# A PMTiles file is read in byte ranges. If CloudFront kept ranges of the old
# file and served them beside ranges of the new one, the map would draw
# garbage, so the cached copies are always dropped after an upload.
aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION" \
    --paths "/data/*" --query "Invalidation.Id" --output text

echo "Done."
