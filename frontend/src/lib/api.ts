export async function request<T>(url:string, options:RequestInit = {}):Promise<T> {
  const response = await fetch(`/api/v1${url}`,{...options,headers:{'Content-Type':'application/json',...options.headers}});
  const data = await response.json();
  if (!response.ok) { const error = new Error(Array.isArray(data.message) ? data.message.join('. ') : data.message ?? 'Request failed'); Object.assign(error,{status:response.status}); throw error; }
  return data;
}
