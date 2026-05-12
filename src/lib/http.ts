// @ts-nocheck
function asyncHandler(handler) {
  return function wrappedHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store");
}

export {
  asyncHandler,
  setNoStore,
};
