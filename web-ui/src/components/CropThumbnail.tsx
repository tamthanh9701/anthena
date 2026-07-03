import React from 'react';
import { Image } from 'antd';
import { getNodeThumbnailUrl, getNodeCropUrl } from '../api/endpoints';

interface CropThumbnailProps {
  snapshotId?: string;
  nodeId?: string;
  cropUrl?: string;
  alt?: string;
  size?: number;
  style?: React.CSSProperties;
}

const CropThumbnail: React.FC<CropThumbnailProps> = ({
  snapshotId,
  nodeId,
  cropUrl,
  alt = 'Node crop',
  size = 120,
  style,
}) => {
  const src = cropUrl || (snapshotId && nodeId ? getNodeThumbnailUrl(snapshotId, nodeId) : undefined);

  return (
    <Image
      src={src}
      alt={alt}
      width={size}
      height={size}
      style={{ objectFit: 'cover', borderRadius: 4, ...style }}
      fallback="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9IjEyMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTIwIiBoZWlnaHQ9IjEyMCIgZmlsbD0iI2YwZjBmMCIvPjx0ZXh0IHg9IjYwIiB5PSI2MCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPk5vIEltYWdlPC90ZXh0Pjwvc3ZnPg=="
      preview={false}
    />
  );
};

export default CropThumbnail;