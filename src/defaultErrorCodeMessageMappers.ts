
const REGEX_2792 = /([^\n]+) Did you mean to set the 'moduleResolution' option to 'node', or to add aliases to the 'paths' option\?/;

export const defaultErrorCodeMessageMappers: {
  [key: number]: (msg: string) => string | undefined;
} = {
  2792: msg => {
    const match = REGEX_2792.exec(msg);
    if (match !== null) {
      return match[1];
    }
  },
};


