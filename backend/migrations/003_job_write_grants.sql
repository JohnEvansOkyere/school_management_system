REVOKE UPDATE ON outbox_jobs FROM school_app,school_worker;
GRANT UPDATE(state,attempts,available_at,lease_until,lease_token,result,last_error,completed_at) ON outbox_jobs TO school_worker;
