--
-- PostgreSQL database dump
--

\restrict YmVpy4dfzz3IJmPiPEOTp3Vxyss575tktn1fprjoS2hnVwTuPNjdP1x5AqUapY4

-- Dumped from database version 16.15 (b357239)
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: mahjong_sessions; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.mahjong_sessions (
    id integer NOT NULL,
    played_on date NOT NULL,
    rounds integer NOT NULL,
    total_amount double precision NOT NULL,
    winner_name text NOT NULL,
    notes text,
    created_by_user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    player_balances jsonb DEFAULT '[]'::jsonb NOT NULL
);


ALTER TABLE public.mahjong_sessions OWNER TO neondb_owner;

--
-- Name: mahjong_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.mahjong_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.mahjong_sessions_id_seq OWNER TO neondb_owner;

--
-- Name: mahjong_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.mahjong_sessions_id_seq OWNED BY public.mahjong_sessions.id;


--
-- Name: mahjong_sessions id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.mahjong_sessions ALTER COLUMN id SET DEFAULT nextval('public.mahjong_sessions_id_seq'::regclass);


--
-- Data for Name: mahjong_sessions; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.mahjong_sessions (id, played_on, rounds, total_amount, winner_name, notes, created_by_user_id, created_at, player_balances) FROM stdin;
7	2026-09-11	4	2000	Ash	\N	user_3Ir3QQ8fGBCWNHW4pgaC58wuxrH	2026-09-11 14:48:24.530626+00	[{"name": "Kah wei", "zhaHuCount": 0, "endingAmount": 433, "xieXieKaiXiangCount": 0}, {"name": "Saetan", "zhaHuCount": 0, "endingAmount": 485, "xieXieKaiXiangCount": 0}, {"name": "Nick", "zhaHuCount": 0, "endingAmount": 501, "xieXieKaiXiangCount": 0}, {"name": "Ash", "zhaHuCount": 0, "endingAmount": 581, "xieXieKaiXiangCount": 0}]
8	2026-09-12	4	2000	Ash	\N	user_3JBgmApR9PzUmIGD9wAby7MLqAq	2026-09-11 17:02:24.16956+00	[{"name": "Wei Lun", "zhaHuCount": 0, "endingAmount": 544, "xieXieKaiXiangCount": 0}, {"name": "Ash", "zhaHuCount": 0, "endingAmount": 544, "xieXieKaiXiangCount": 0}, {"name": "SaeTan", "zhaHuCount": 0, "endingAmount": 452, "xieXieKaiXiangCount": 0}, {"name": "Kah Wei", "zhaHuCount": 0, "endingAmount": 460, "xieXieKaiXiangCount": 0}]
6	2026-09-05	4	2000	Nick	\N	user_3Ir3QQ8fGBCWNHW4pgaC58wuxrH	2026-09-04 16:36:50.114091+00	[{"name": "Wei Lun", "zhaHuCount": 0, "endingAmount": 403, "xieXieKaiXiangCount": 0}, {"name": "Nick", "zhaHuCount": 0, "endingAmount": 563, "xieXieKaiXiangCount": 0}, {"name": "Dong", "zhaHuCount": 0, "endingAmount": 559, "xieXieKaiXiangCount": 0}, {"name": "Kah Wei", "zhaHuCount": 0, "endingAmount": 475, "xieXieKaiXiangCount": 0}]
5	2026-09-04	4	2000	Kah wei	\N	user_3Ir3QQ8fGBCWNHW4pgaC58wuxrH	2026-09-04 14:25:37.131653+00	[{"name": "Kah wei", "zhaHuCount": 0, "endingAmount": 587, "xieXieKaiXiangCount": 0}, {"name": "Wei lun", "zhaHuCount": 0, "endingAmount": 415, "xieXieKaiXiangCount": 0}, {"name": "Nick", "zhaHuCount": 0, "endingAmount": 435, "xieXieKaiXiangCount": 0}, {"name": "Dong", "zhaHuCount": 0, "endingAmount": 563, "xieXieKaiXiangCount": 0}]
\.


--
-- Name: mahjong_sessions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.mahjong_sessions_id_seq', 8, true);


--
-- Name: mahjong_sessions mahjong_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.mahjong_sessions
    ADD CONSTRAINT mahjong_sessions_pkey PRIMARY KEY (id);


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: cloud_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE cloud_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO neon_superuser WITH GRANT OPTION;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: cloud_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE cloud_admin IN SCHEMA public GRANT ALL ON TABLES TO neon_superuser WITH GRANT OPTION;


--
-- PostgreSQL database dump complete
--

\unrestrict YmVpy4dfzz3IJmPiPEOTp3Vxyss575tktn1fprjoS2hnVwTuPNjdP1x5AqUapY4

