export default ({ env }) => ({
  upload: {
    config: {
      provider: 'aws-s3',
      providerOptions: {
        credentials: {
          accessKeyId: env('R2_ACCESS_KEY_ID'),
          secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
        },
        region: 'auto', // Cloudflare R2 requires 'auto'
        endpoint: `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
        baseUrl: env('R2_PUBLIC_URL'), // Use public URL for file access
        params: {
          Bucket: env('R2_BUCKET'),
          ACL: null, // Cloudflare R2 does not support ACLs, disable it to avoid Access Denied
        },
      },
      actionOptions: {
        upload: {},
        uploadStream: {},
        delete: {},
      },
      security: {
        deniedTypes: [
          'application/x-msdownload',
          'application/x-msdos-program',
          'application/x-dosexec',
          'application/x-sh',
          'text/x-shellscript',
          'application/x-bat',
          'text/x-bat',
        ],
      },
    },
  },
});
