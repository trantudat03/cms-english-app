export default () => ({
  upload: {
    config: {
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
