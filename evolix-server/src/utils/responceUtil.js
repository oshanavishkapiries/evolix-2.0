const sendResponse = (res, statusCode, message, data = null) => {
  const responsePayload = {
    success: statusCode >= 200 && statusCode < 300,
    statusCode,
    message,
    data,
  };

  console.log(`📤 Response ${statusCode}:`, responsePayload);
  res.status(statusCode).json(responsePayload);
};

const successResponse = (res, message, data = null) =>
  sendResponse(res, 200, message, data);
const badRequestResponse = (res, message = "Invalid request") =>
  sendResponse(res, 400, message);
const unauthorizedResponse = (res, message = "Unauthorized") =>
  sendResponse(res, 401, message);
const notFoundResponse = (res, message = "Not found") =>
  sendResponse(res, 404, message);
const serverErrorResponse = (res, message = "Server error") =>
  sendResponse(res, 500, message);

module.exports = {
  successResponse,
  badRequestResponse,
  unauthorizedResponse,
  notFoundResponse,
  serverErrorResponse,
};
