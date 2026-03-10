export default ({ env }) => ({
  documentation: {
    enabled: true,
    config: {
      openapi: '3.0.0',
      info: {
        version: '1.0.0',
        title: 'My Strapi Project API',
        description: 'API documentation for My Strapi Project',
        termsOfService: 'YOUR_TERMS_OF_SERVICE_URL',
        contact: {
          name: 'TEAM',
          email: 'contact-email@something.io',
          url: 'mywebsite.io'
        },
        license: {
          name: 'Apache 2.0',
          url: 'https://www.apache.org/licenses/LICENSE-2.0.html'
        },
      },
      'x-strapi-config': {
        // Show all plugins in documentation
        path: '/documentation',
      },
      servers: [
        { url: 'http://localhost:1337/api', description: 'Development server' },
      ],
      security: [
        { bearerAuth: [] }
      ]
    }
  },
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
