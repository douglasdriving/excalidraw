import { useEffect, useState } from "react";

import { localFilesApi } from "./api";

/** A canvas preview read from storage; `modified` re-reads it after saves. */
export const Thumbnail = ({
  name,
  modified,
}: {
  name: string;
  modified: number;
}) => {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    localFilesApi
      .thumbnail(name)
      .then((blob) => {
        if (blob && !cancelled) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [name, modified]);

  return url ? <img src={url} alt="" /> : null;
};
